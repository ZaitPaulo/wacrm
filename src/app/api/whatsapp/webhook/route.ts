import { NextResponse, after } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { decrypt, encrypt, isLegacyFormat } from '@/lib/whatsapp/encryption';
import { getMediaUrl } from '@/lib/whatsapp/meta-api';
import { normalizePhone } from '@/lib/whatsapp/phone-utils';
import {
  persistInbound,
  fanOutInbound,
  type InboundSender,
  type InboundFanout,
  type InboundOutcome,
} from '@/lib/inbound/core';
import { verifyMetaWebhookSignature } from '@/lib/whatsapp/webhook-signature';
import { serverSupabaseUrl } from '@/lib/supabase/server-url';
import { dispatchWebhookEvent } from '@/lib/webhooks/deliver';
import {
  handleTemplateWebhookChange,
  isTemplateWebhookField,
} from '@/lib/whatsapp/template-webhook';

// Cubre las DOS fases: lo que se guarda dentro de la petición y lo que
// se difunde después, en el `after()`. La holgura sigue haciendo falta
// por la difusión, que es la parte lenta —flujos, automatizaciones, IA,
// webhooks de terceros—; la persistencia es solo base y no mueve la
// aguja. La verificación de medios, que antes era la razón principal de
// pedir margen, ahora tiene su propio tiempo límite y no puede estirar
// la respuesta (ver MEDIA_VERIFY_TIMEOUT_MS).
export const maxDuration = 60;

// Lazy-initialized to avoid build-time crash when env vars are missing
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _adminClient: any = null;
function supabaseAdmin() {
  if (!_adminClient) {
    // Ruta interna cuando el despliegue la configura: este es EL camino
    // que perdía mensajes cuando el DNS externo del contenedor fallaba.
    // Ver src/lib/supabase/server-url.ts.
    _adminClient = createClient(
      serverSupabaseUrl(),
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }
  return _adminClient;
}

interface WhatsAppMessage {
  id: string;
  from: string;
  timestamp: string;
  type: string;
  text?: { body: string };
  image?: { id: string; mime_type: string; caption?: string };
  video?: { id: string; mime_type: string; caption?: string };
  document?: {
    id: string;
    mime_type: string;
    filename?: string;
    caption?: string;
  };
  audio?: { id: string; mime_type: string };
  sticker?: { id: string; mime_type: string };
  location?: {
    latitude: number;
    longitude: number;
    name?: string;
    address?: string;
  };
  reaction?: { message_id: string; emoji: string };
  /**
   * Set when the customer taps a button or list row on an interactive
   * message we sent. `button_reply.id` / `list_reply.id` is whatever id
   * we put on the button/row when sending — the Flows engine uses this
   * to advance the per-contact run.
   */
  interactive?: {
    type: 'button_reply' | 'list_reply';
    button_reply?: { id: string; title: string };
    list_reply?: { id: string; title: string; description?: string };
  };
  /**
   * Set when the customer taps a QUICK_REPLY button on a *template*
   * message — a broadcast, or any template send. Meta uses a different
   * envelope from `interactive` above: `type: 'button'`, the label in
   * `button.text`, and the payload configured on the template's button
   * in `button.payload` (Meta's own template editor doesn't ask for a
   * payload and mirrors the label into it).
   */
  button?: { text?: string; payload?: string };
  /** Present when the customer swipe-replies to one of our messages. */
  context?: { id: string };
}

/**
 * El sobre que Meta manda, sea del canal que sea.
 *
 * `object` es lo que distingue de qué producto viene el evento, y es lo
 * único que se puede mirar antes de saber qué forma tiene el resto:
 *
 *   whatsapp_business_account → entry[].changes[]
 *   instagram                 → entry[].messaging[]
 *   page  (Messenger)         → entry[].messaging[]
 *
 * Los tres llegan a ESTA MISMA URL. La dirección no cambia a propósito:
 * ya está registrada en las cuentas de Meta de las instalaciones que
 * funcionan, y renombrarla obligaría a reconfigurar cada una. El nombre
 * `/api/whatsapp/webhook` queda desalineado con lo que hace — deuda
 * consciente, documentada acá en vez de romper instalaciones por
 * estética.
 */
interface MetaWebhookBody {
  object?: string;
  entry?: WhatsAppWebhookEntry[];
}

/** Los valores de `object` que sabemos procesar hoy. */
const WHATSAPP_OBJECT = 'whatsapp_business_account';

interface WhatsAppWebhookEntry {
  id: string;
  changes: Array<{
    value: {
      messaging_product: string;
      metadata: {
        display_phone_number: string;
        phone_number_id: string;
      };
      contacts?: Array<{
        profile: { name: string };
        wa_id: string;
      }>;
      messages?: WhatsAppMessage[];
      statuses?: Array<{
        id: string;
        status: string;
        timestamp: string;
        recipient_id: string;
      }>;
    };
    field: string;
  }>;
}

// GET - Webhook verification
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const mode = searchParams.get('hub.mode');
    const challenge = searchParams.get('hub.challenge');
    const verifyToken = searchParams.get('hub.verify_token');

    if (mode !== 'subscribe' || !challenge || !verifyToken) {
      return NextResponse.json(
        { error: 'Missing verification parameters' },
        { status: 400 }
      );
    }

    // Fetch all whatsapp configs to check verify tokens
    const { data: configs, error: configError } = await supabaseAdmin()
      .from('whatsapp_config')
      .select('id, verify_token');

    if (configError || !configs) {
      console.error('Error fetching configs for verification:', configError);
      return NextResponse.json(
        { error: 'Verification failed' },
        { status: 403 }
      );
    }

    // Check if any config's verify_token matches. Also collect the
    // matching row so we can opportunistically upgrade its token to
    // GCM if it was still in the legacy CBC format.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let matchedConfig: any = null;
    for (const config of configs) {
      if (!config.verify_token) continue;
      try {
        if (decrypt(config.verify_token) === verifyToken) {
          matchedConfig = config;
          break;
        }
      } catch {
        // Malformed / wrong-key token row — skip it and keep checking.
      }
    }

    if (matchedConfig) {
      // Fire-and-forget GCM upgrade. Safe to run on every subscribe
      // since it's a no-op once the column is already GCM.
      if (isLegacyFormat(matchedConfig.verify_token)) {
        void supabaseAdmin()
          .from('whatsapp_config')
          .update({ verify_token: encrypt(verifyToken) })
          .eq('id', matchedConfig.id)
          .then(({ error }: { error: unknown }) => {
            if (error) {
              console.warn(
                '[webhook] verify_token GCM upgrade failed:',
                (error as { message?: string })?.message ?? error
              );
            }
          });
      }
      // Return challenge as plain text
      return new Response(challenge, {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      });
    }

    return NextResponse.json(
      { error: 'Verification token mismatch' },
      { status: 403 }
    );
  } catch (error) {
    console.error('Error in webhook GET verification:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// POST - Receive messages
export async function POST(request: Request) {
  // Read raw body first so we can HMAC-verify the exact bytes Meta
  // signed. request.json() would re-encode and break the signature.
  const rawBody = await request.text();
  const signature = request.headers.get('x-hub-signature-256');

  if (!verifyMetaWebhookSignature(rawBody, signature)) {
    // 401 (not 200) — we want Meta's delivery dashboard to show failures
    // loudly if a misconfiguration causes signatures to stop matching,
    // rather than silently eating events.
    console.warn('[webhook] rejected request with invalid signature');
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let body: MetaWebhookBody;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // La recepción va en dos fases, y el corte no es cosmético.
  //
  // PRIMERO se guarda, y solo entonces se confirma. Antes se respondía
  // 200 y se procesaba todo dentro de `after()`; cuando ese trabajo
  // fallaba —el DNS del contenedor cayéndose de a ratos, el 2026-09-08—
  // el mensaje se perdía para siempre, porque Meta ya tenía su
  // confirmación y no reintenta lo que dio por entregado. No quedaba ni
  // la fila ni forma de enterarse.
  //
  // DESPUÉS se difunde. Lo lento y lo que habla con terceros —flujos,
  // automatizaciones, IA, webhooks públicos— sigue en `after()`, y por
  // la misma razón de siempre: sostener la respuesta mientras corre se
  // sale de la ventana de Meta y provoca reentregas por timeout.
  //
  // `after()` y no una promesa suelta: en serverless el proceso puede
  // congelarse apenas sale la respuesta, y las escrituras de una promesa
  // flotante no llegaban a completarse (issue #301). `after()` le entrega
  // la promesa al runtime, que mantiene viva la función hasta que
  // resuelve, dentro del `maxDuration` de la ruta.
  let batch: InboundBatch;
  try {
    batch = await persistWebhook(body);
  } catch (error) {
    // Una excepción acá no se sabe si dejó algo a medias: se pide
    // reentrega, que la idempotencia hace segura.
    console.error('[webhook] error inesperado persistiendo el lote:', error);
    return NextResponse.json({ error: 'Persist failed' }, { status: 500 });
  }

  // La difusión se agenda incluso cuando el lote va a responder 500: lo
  // que SÍ se guardó merece su respuesta automática, y la reentrega de
  // Meta reconocerá esas filas como replay sin volver a difundirlas.
  if (batch.fanouts.length > 0) {
    after(async () => {
      for (const ctx of batch.fanouts) {
        try {
          await fanOutInbound(ctx);
        } catch (error) {
          // Nunca cambia la respuesta, que además ya salió. Un reintento
          // por esto no arreglaría nada: el mensaje volvería, se
          // reconocería como replay y la difusión no correría igual.
          console.error('[webhook] error difundiendo un entrante:', error);
        }
      }
    });
  }

  if (batch.transientFailures.length > 0) {
    console.error(
      `[webhook] ${batch.transientFailures.length} entrante(s) sin guardar, se pide reentrega:`,
      batch.transientFailures.join('; ')
    );
    return NextResponse.json({ error: 'Persist failed' }, { status: 500 });
  }

  return NextResponse.json({ status: 'received' }, { status: 200 });
}

/**
 * Lo que la fase de persistencia deja listo para el resto de la petición.
 *
 * `transientFailures` no vacío significa que hay que responder no-200 y
 * que Meta reentregue el lote ENTERO. Es seguro: lo que ya se guardó se
 * reconoce como replay en la reentrega y no se duplica ni se vuelve a
 * difundir. Perder solo el mensaje que falló, que es lo que pasaba antes,
 * es justamente el agujero que esto cierra.
 */
interface InboundBatch {
  fanouts: InboundFanout[];
  transientFailures: string[];
}

/**
 * Cuánto se espera a que Meta confirme un medio antes de seguir sin él.
 *
 * Valor conservador, no medido: se eligió holgado para no descartar
 * medios que hoy verifican bien, y su único trabajo es impedir que una
 * llamada colgada retenga la confirmación a Meta. Si alguna vez se mide
 * el caso normal, este número puede bajar.
 */
const MEDIA_VERIFY_TIMEOUT_MS = 5000;

/** Rechaza si la promesa no resuelve a tiempo. El temporizador se limpia. */
function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string
): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label}: se agotaron ${ms}ms`)),
      ms
    );
  });
  return Promise.race([promise, timeout]).finally(() =>
    clearTimeout(timer)
  ) as Promise<T>;
}

/**
 * Enruta el cuerpo entrante al manejador de su canal y devuelve lo que
 * la persistencia dejó lista.
 *
 * Un `object` que no reconocemos se REGISTRA Y SE DESCARTA, nunca lanza,
 * y NO pide reentrega: es un fallo permanente, y reintentarlo daría lo
 * mismo hasta que Meta se rinda, llenando su panel de entregas fallidas
 * con ruido que taparía los fallos que sí importan.
 */
async function persistWebhook(body: MetaWebhookBody): Promise<InboundBatch> {
  // Sin `object` se asume WhatsApp: es lo que mandaban las
  // instalaciones existentes antes de que este enrutador existiera, y
  // ninguna debe dejar de funcionar por un campo que no mirábamos.
  const object = body.object ?? WHATSAPP_OBJECT;

  if (object === WHATSAPP_OBJECT) {
    return persistWhatsAppWebhook(body);
  }

  // Instagram y Messenger todavía no tienen manejador — llegan en
  // `entry[].messaging[]`, con otra forma. Se registra para que se vea
  // que la suscripción está activa antes de que exista el código.
  console.info(
    `[webhook] evento de '${object}' recibido y descartado: todavía no hay manejador para ese canal`
  );
  return { fanouts: [], transientFailures: [] };
}

async function persistWhatsAppWebhook(body: {
  entry?: WhatsAppWebhookEntry[];
}): Promise<InboundBatch> {
  const batch: InboundBatch = { fanouts: [], transientFailures: [] };
  if (!body.entry) return batch;

  for (const entry of body.entry) {
    for (const change of entry.changes ?? []) {
      // Cada cambio se aísla: un lote puede traer varios eventos y el
      // fallo de uno no puede llevarse a los demás por delante. Sin
      // esto, una excepción a mitad del recorrido descartaba en
      // silencio todos los mensajes que venían después en el mismo
      // lote.
      //
      // Lo que SÍ cambió es qué se hace con ese fallo: ya no se traga.
      // Se sigue procesando el resto del lote y al final se pide
      // reentrega del lote entero, que la idempotencia hace segura.
      try {
        await persistWhatsAppChange(change, batch);
      } catch (error) {
        console.error('[webhook] error procesando un evento del lote:', error);
        batch.transientFailures.push(
          `evento del lote: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  }
  return batch;
}

async function persistWhatsAppChange(
  change: WhatsAppWebhookEntry['changes'][number],
  batch: InboundBatch
) {
  // Template-lifecycle events (status / quality / components
  // updates from Meta) come in on a different change.field and
  // have a different value shape — route them through the
  // dedicated handler. Skip the messaging branches below so we
  // don't try to read message-shaped fields off a template event.
  if (isTemplateWebhookField(change.field)) {
    await handleTemplateWebhookChange(
      { field: change.field, value: change.value as unknown },
      supabaseAdmin()
    );
    return;
  }

  const value = change.value;

  // Handle status updates
  if (value.statuses) {
    for (const status of value.statuses) {
      await handleStatusUpdate(status);
    }
  }

  // Handle incoming messages
  if (!value.messages || !value.contacts) return;

  const phoneNumberId = value.metadata.phone_number_id;

  // Find user's config by phone_number_id. `.single()` returns
  // PGRST116 for both 0 rows AND ≥2 rows — distinguish them so
  // operators see the real cause in logs. ≥2 rows shouldn't happen
  // post-migration 013 (UNIQUE constraint), but a row created
  // before the constraint, or a race, would still surface here.
  const { data: configRows, error: configError } = await supabaseAdmin()
    .from('whatsapp_config')
    .select('*')
    .eq('phone_number_id', phoneNumberId);

  if (configError) {
    console.error(
      'Error fetching whatsapp_config for phone_number_id:',
      phoneNumberId,
      configError
    );
    // TRANSITORIO: la base no respondió. Es el primer punto del camino
    // de entrada que tocaba la base, y por lo tanto el primero que
    // fallaba cuando la red se caía. Que Meta reentregue.
    batch.transientFailures.push(
      `whatsapp_config no consultable para ${phoneNumberId}`
    );
    return;
  }

  // PERMANENTE de acá en adelante: un número que no está configurado, o
  // que está dos veces, va a dar el mismo resultado en cada reintento.
  // Se descarta con 200 y queda en el log.
  if (!configRows || configRows.length === 0) {
    console.error('No config found for phone_number_id:', phoneNumberId);
    return;
  }

  if (configRows.length > 1) {
    console.error(
      `Multiple configs (${configRows.length}) found for phone_number_id:`,
      phoneNumberId,
      '— inbound message dropped. Resolve duplicates so each number maps to a single account.',
      'Account owners:',
      configRows.map(
        (r: { account_id: string; user_id: string }) =>
          `${r.account_id} (admin ${r.user_id})`
      )
    );
    return;
  }

  const config = configRows[0];

  const decryptedAccessToken = decrypt(config.access_token);

  for (let i = 0; i < value.messages.length; i++) {
    const message = value.messages[i];
    const contact = value.contacts[i] || value.contacts[0];

    await persistMessage(
      message,
      contact,
      // Tenancy — drives every contact / conversation lookup
      // and the engines' active-row dispatch.
      config.account_id,
      // Audit / sender-of-record — used as the user_id on row
      // inserts that need it for NOT NULL FK compliance. Always
      // the admin who saved the WhatsApp config.
      config.user_id,
      decryptedAccessToken,
      batch
    );
  }
}

// The happy-path status ladder — pending → sent → delivered → read →
// replied. Webhook replays must never regress a recipient back down
// this ladder.
//
// `failed` is NOT on this ladder. It's a terminal side branch that is
// only valid from the early states (pending / sent) — once Meta has
// delivered or the user has read or replied, a later "failed" status
// event is a bug in Meta's pipeline or a spoof attempt and must be
// ignored.
const RECIPIENT_STATUS_LADDER = [
  'pending',
  'sent',
  'delivered',
  'read',
  'replied',
] as const;

function ladderLevel(s: string): number {
  const idx = (RECIPIENT_STATUS_LADDER as readonly string[]).indexOf(s);
  return idx < 0 ? -1 : idx;
}

/**
 * Can a recipient transition from `current` to `incoming`?
 *   - Along the ladder, only forward moves are allowed.
 *   - `failed` is accepted only from `pending` or `sent`; it's refused
 *     once the recipient has reached any of the success states.
 */
function isValidStatusTransition(current: string, incoming: string): boolean {
  if (incoming === 'failed') {
    return current === 'pending' || current === 'sent';
  }
  if (current === 'failed') {
    return false; // failed is terminal
  }
  const ci = ladderLevel(current);
  const ii = ladderLevel(incoming);
  if (ii < 0) return false; // unknown incoming status
  if (ci < 0) return true; // unknown current — accept anything on the ladder
  return ii > ci;
}

async function handleStatusUpdate(status: {
  id: string;
  status: string;
  timestamp: string;
  recipient_id: string;
}) {
  // 1) Mirror onto messages (legacy behavior) — Meta's status values
  //    already match the CHECK constraint on messages.status. No
  //    `.select()`: message_id is NOT unique (migration 009 — Meta ids
  //    repeat across numbers), so this updates 0..N rows and must not
  //    assume a single row.
  const { error: msgErr } = await supabaseAdmin()
    .from('messages')
    .update({ status: status.status })
    .eq('message_id', status.id);

  if (msgErr) {
    console.error('Error updating message status:', msgErr);
  }

  // Webhook fan-out for this status change happens at the END of this
  // handler (after the broadcast mirror below), so a slow subscriber
  // endpoint can't delay the broadcast_recipients update.

  // 2) Mirror onto broadcast_recipients via whatsapp_message_id
  //    (added in migration 003). The aggregate trigger on
  //    broadcast_recipients re-derives the parent broadcast's
  //    sent/delivered/read/failed counts automatically.
  const tsIso = new Date(parseInt(status.timestamp) * 1000).toISOString();

  const { data: recipient, error: recFetchErr } = await supabaseAdmin()
    .from('broadcast_recipients')
    .select('id, status')
    .eq('whatsapp_message_id', status.id)
    .maybeSingle();

  if (recFetchErr) {
    console.error('Error fetching broadcast recipient:', recFetchErr);
  } else if (
    recipient &&
    // Guard transitions — forward-only on the success ladder, and
    // `failed` only from pre-delivered states.
    isValidStatusTransition(recipient.status, status.status)
  ) {
    const update: Record<string, unknown> = { status: status.status };
    if (status.status === 'sent' && !('sent_at' in update))
      update.sent_at = tsIso;
    if (status.status === 'delivered') update.delivered_at = tsIso;
    if (status.status === 'read') update.read_at = tsIso;

    const { error: recUpdateErr } = await supabaseAdmin()
      .from('broadcast_recipients')
      .update(update)
      .eq('id', recipient.id);

    if (recUpdateErr) {
      console.error('Error updating broadcast recipient status:', recUpdateErr);
    }
  }

  // 3) Webhook fan-out for messages we store (inbox / API sends).
  //    Runs last so a slow subscriber can't delay the mirrors above.
  //    Bounded to one row (message_id isn't unique) purely to resolve
  //    the owning account for delivery.
  const { data: msgRow } = await supabaseAdmin()
    .from('messages')
    .select('conversation_id, conversations(account_id)')
    .eq('message_id', status.id)
    .limit(1)
    .maybeSingle();

  if (msgRow) {
    const conv = msgRow.conversations as { account_id: string } | null;
    const accountId = conv?.account_id;
    if (accountId) {
      await dispatchWebhookEvent(
        supabaseAdmin(),
        accountId,
        'message.status_updated',
        {
          whatsapp_message_id: status.id,
          conversation_id: msgRow.conversation_id,
          status: status.status,
        }
      );
    }
  }
}

/**
 * Traduce un mensaje de WhatsApp a la forma normalizada y se lo entrega
 * al núcleo compartido.
 *
 * TODO lo propio de WhatsApp vive acá: de dónde sale la identidad del
 * remitente, cómo se descargan los medios, qué tipos existen y cómo se
 * mapean a los que admite `messages.content_type`. Lo que pasa después
 * —contacto, conversación, guardado idempotente, flujos,
 * automatizaciones, IA y webhooks— es igual en los tres canales y vive
 * en `src/lib/inbound/core.ts`.
 */
async function persistMessage(
  message: WhatsAppMessage,
  contact: { profile: { name: string }; wa_id: string },
  // Tenancy. Resolved from the matched whatsapp_config row.
  accountId: string,
  // Sender-of-record for inserts that need a NOT NULL user_id FK.
  configOwnerUserId: string,
  accessToken: string,
  // Recoge lo que hay que difundir después de responder, y lo que no se
  // pudo guardar y por lo tanto exige reentrega.
  batch: InboundBatch
) {
  const sender: InboundSender = {
    channel: 'whatsapp',
    // La identidad de WhatsApp es el número normalizado, que es la
    // misma forma con la que la 513 pobló `contact_channels`.
    externalId: normalizePhone(message.from),
    name: contact.profile.name || null,
  };

  // DIAGNÓSTICO — no hay contacto que resolver y el mensaje se va a
  // descartar. Pasa con remitentes cuya identidad NO es un teléfono
  // (vistos en producción como `CO.4481978948757066` dentro del wamid),
  // y hasta hoy ocurría en silencio: no quedaba ni la fila ni el log,
  // así que los mensajes de esas personas desaparecían sin que nadie
  // pudiera enterarse. Se vuelca el sobre completo para poder darle a
  // la identidad el tratamiento que corresponda en vez de adivinarlo.
  if (!sender.externalId) {
    console.error(
      '[webhook] remitente sin teléfono utilizable — sobre completo:',
      JSON.stringify({
        from: message.from,
        type: message.type,
        id: message.id,
        contact,
      })
    );
  }

  const common = {
    db: supabaseAdmin(),
    accountId,
    auditUserId: configOwnerUserId,
    sender,
  };

  // Las reacciones se resuelven antes de tocar los medios: no son
  // mensajes y no hace falta bajar nada para procesarlas.
  if (message.type === 'reaction') {
    if (!message.reaction?.message_id) return;
    collect(
      await persistInbound({
        ...common,
        inbound: {
          kind: 'reaction',
          targetExternalId: message.reaction.message_id,
          emoji: message.reaction.emoji || null,
        },
      }),
      batch,
      message.id
    );
    return;
  }

  const { contentText, mediaUrl, mediaType, interactiveReplyId } =
    await parseMessageContent(message, accessToken);

  // `mediaType` no se persiste: la tabla no tiene esa columna y el MIME
  // sólo sirve para construir la URL del proxy dentro de
  // parseMessageContent.
  void mediaType;

  // The messages.content_type CHECK constraint (widened in migration 010
  // to add 'interactive' for button/list taps) allows:
  //   text, image, document, audio, video, location, template, interactive
  // Map incoming WhatsApp types that aren't in that list to the closest
  // allowed value so the INSERT doesn't fail with a constraint error.
  const ALLOWED_CONTENT_TYPES = new Set([
    'text',
    'image',
    'document',
    'audio',
    'video',
    'location',
    'template',
    'interactive',
  ]);
  const contentType = ALLOWED_CONTENT_TYPES.has(message.type)
    ? message.type
    : message.type === 'sticker'
      ? 'image' // stickers are images
      : message.type === 'button'
        ? 'interactive' // template quick-reply tap (issue #478)
        : 'text'; // unknown → text fallback

  collect(
    await persistInbound({
      ...common,
      inbound: {
        kind: 'message',
        externalMessageId: message.id,
        sentAt: new Date(parseInt(message.timestamp) * 1000),
        contentType,
        contentText,
        mediaUrl,
        interactiveReplyId,
        replyToExternalId: message.context?.id ?? null,
        typeLabel: message.type,
      },
    }),
    batch,
    message.id
  );
}

/**
 * Traduce el desenlace de la persistencia a lo que el lote necesita
 * recordar: qué difundir, y qué exige reentrega.
 *
 * `duplicate` y `dropped` no agregan nada a ninguna de las dos listas, y
 * eso es exactamente lo correcto: en el primer caso el mensaje ya estaba
 * y su difusión ya ocurrió (issue #367); en el segundo, reintentar daría
 * el mismo resultado.
 */
function collect(
  outcome: InboundOutcome,
  batch: InboundBatch,
  externalMessageId: string
) {
  if (outcome.status === 'persisted') {
    batch.fanouts.push(outcome.fanout);
    return;
  }
  if (outcome.status === 'failed') {
    batch.transientFailures.push(`${externalMessageId}: ${outcome.reason}`);
    return;
  }
  if (outcome.status === 'dropped') {
    console.warn(
      `[webhook] entrante descartado (${outcome.reason}):`,
      externalMessageId
    );
  }
}

async function parseMessageContent(
  message: WhatsAppMessage,
  accessToken: string
): Promise<{
  contentText: string | null;
  mediaUrl: string | null;
  mediaType: string | null;
  /**
   * For interactive button / list replies: the stable id of the tapped
   * option (whatever we put on the button when sending). Used by the
   * Flows engine to advance the per-contact run; persisted to
   * `messages.interactive_reply_id` so the inbox bubble can render the
   * tap with the right affordance. Null for everything else.
   */
  interactiveReplyId: string | null;
}> {
  // getMediaUrl signature is (mediaId, accessToken) — earlier code had
  // the args swapped, so every verification hit an invalid Meta URL and
  // fell through to the catch block, leaving mediaUrl as null. That's
  // why images showed up as empty bubbles in the inbox.
  const verifyAndBuildUrl = async (mediaId: string): Promise<string | null> => {
    try {
      // Con tiempo límite: esta verificación corre AHORA dentro de la
      // petición, porque el mensaje se guarda antes de confirmarle a
      // Meta. Es una llamada de red a un tercero, y no puede ser lo que
      // decida si Meta reentrega — si tarda, se sigue por el mismo
      // camino que ya existía para cuando falla, y el mensaje queda
      // guardado con su texto. Perder el pie de foto es mucho menos
      // grave que perder el mensaje entero.
      await withTimeout(
        getMediaUrl({ mediaId, accessToken }),
        MEDIA_VERIFY_TIMEOUT_MS,
        `verificación del medio ${mediaId}`
      );
      return `/api/whatsapp/media/${mediaId}`;
    } catch (error) {
      console.error(
        `Failed to verify media ${mediaId} with Meta:`,
        error instanceof Error ? error.message : error
      );
      return null;
    }
  };

  // Default shape — each case overrides only the fields it cares about.
  // Keeps the new `interactiveReplyId` field DRY across every return site.
  const empty = {
    contentText: null,
    mediaUrl: null,
    mediaType: null,
    interactiveReplyId: null,
  };

  switch (message.type) {
    case 'text':
      return { ...empty, contentText: message.text?.body || null };

    case 'image':
      if (message.image?.id) {
        return {
          ...empty,
          contentText: message.image.caption || null,
          mediaUrl: await verifyAndBuildUrl(message.image.id),
          mediaType: message.image.mime_type,
        };
      }
      return empty;

    case 'video':
      if (message.video?.id) {
        return {
          ...empty,
          contentText: message.video.caption || null,
          mediaUrl: await verifyAndBuildUrl(message.video.id),
          mediaType: message.video.mime_type,
        };
      }
      return empty;

    case 'document':
      if (message.document?.id) {
        return {
          ...empty,
          contentText:
            message.document.caption || message.document.filename || null,
          mediaUrl: await verifyAndBuildUrl(message.document.id),
          mediaType: message.document.mime_type,
        };
      }
      return empty;

    case 'audio':
      if (message.audio?.id) {
        return {
          ...empty,
          mediaUrl: await verifyAndBuildUrl(message.audio.id),
          mediaType: message.audio.mime_type,
        };
      }
      return empty;

    case 'sticker':
      // Stickers are images under the hood. Treat them as such so the
      // MessageBubble renders the <img>. The caller maps the DB
      // content_type to 'image' for the CHECK constraint.
      if (message.sticker?.id) {
        return {
          ...empty,
          mediaUrl: await verifyAndBuildUrl(message.sticker.id),
          mediaType: message.sticker.mime_type,
        };
      }
      return empty;

    case 'location':
      if (message.location) {
        const loc = message.location;
        const locationText = [
          loc.name,
          loc.address,
          `${loc.latitude},${loc.longitude}`,
        ]
          .filter(Boolean)
          .join(' - ');
        return { ...empty, contentText: locationText };
      }
      return empty;

    case 'reaction':
      return { ...empty, contentText: message.reaction?.emoji || null };

    case 'interactive': {
      // The customer tapped a reply button or a list row on a message
      // we previously sent. Meta delivers `interactive.button_reply` for
      // 3-button messages and `interactive.list_reply` for list messages.
      // Use the human-readable title as contentText so the inbox bubble
      // renders the tap legibly ("Existing customer"), and stash the
      // stable id separately so the Flows engine can route on it.
      const reply =
        message.interactive?.button_reply ?? message.interactive?.list_reply;
      if (reply?.id) {
        return {
          ...empty,
          contentText: reply.title || reply.id,
          interactiveReplyId: reply.id,
        };
      }
      return { ...empty, contentText: '[Interactive reply]' };
    }

    case 'button': {
      // Quick-reply tap on a TEMPLATE message. Meta delivers these under
      // their own `button` envelope rather than `interactive` above, so
      // without this case they fell through to `default` and landed in
      // the inbox as "[Unsupported message type: button]" with a null
      // interactiveReplyId — which also meant the Flows engine and the
      // `interactive_reply` automation trigger never saw the tap, so
      // nothing chained off a broadcast reply (issue #478).
      //
      // `payload` is the stable value (the analogue of
      // `button_reply.id`); `text` is the visible label. Prefer the
      // payload for routing and the label for display, each falling
      // back to the other since a template may carry only one.
      const payload = message.button?.payload || null;
      const label = message.button?.text || null;
      return {
        ...empty,
        contentText: label || payload,
        interactiveReplyId: payload || label,
      };
    }

    default:
      return {
        ...empty,
        contentText: `[Unsupported message type: ${message.type}]`,
      };
  }
}
