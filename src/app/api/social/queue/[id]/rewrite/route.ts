import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { loadAiConfig } from '@/lib/ai/config';
import { generateReply } from '@/lib/ai/generate';
import { logAiUsage } from '@/lib/ai/usage';
import { supabaseAdmin } from '@/lib/ai/admin-client';
import { AiError } from '@/lib/ai/types';
import { networkAdapter, type NetworkAdapter } from '@/lib/social/networks';

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/social/queue/[id]/rewrite  (admin+)
 *
 * Propone una reescritura del texto con la IA de la cuenta.
 *
 * NO GUARDA NADA y no publica: devuelve el texto para que quien revisa
 * lo lea, lo acepte o lo descarte. La IA nunca decide qué sale — sigue
 * habiendo una persona aprobando (decisión 9 del design).
 *
 * Una cuenta sin IA configurada recibe un 400 con `ai_not_configured`,
 * y la pantalla simplemente no ofrece el botón: la cola funciona igual
 * sin esto.
 */
function buildRewritePrompt(adapter: NetworkAdapter): string {
  const { captionMaxChars, maxHashtags } = adapter.limits;
  const red = adapter.network === 'facebook' ? 'Facebook' : 'Instagram';

  return [
    `Reescribes textos para publicaciones de ${red} de una compraventa de vehículos.`,
    'Recibes un texto ya armado con los datos reales del vehículo.',
    'Reglas:',
    `- No inventes ni cambies ningún dato: precio, año, kilometraje, ciudad y contacto quedan exactamente como están.`,
    '- No agregues datos que no estén en el texto original.',
    // El límite se le pide a la red de ESTA publicación. Pedirle a la IA
    // que respete un tope ajeno produce un texto que después se rechaza
    // al guardar, o uno recortado sin necesidad.
    maxHashtags === null
      ? `- Máximo ${captionMaxChars} caracteres.`
      : `- Máximo ${captionMaxChars} caracteres y ${maxHashtags} etiquetas.`,
    '- Conserva el idioma del texto original.',
    '- Devuelve solo el texto final, sin comillas ni explicaciones.',
  ].join('\n');
}

export async function POST(request: Request, { params }: Params) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin');

    const userLimit = checkRateLimit(
      `social-rewrite:${userId}`,
      RATE_LIMITS.aiDraft
    );
    if (!userLimit.success) return rateLimitResponse(userLimit);
    // Tope también para el equipo entero sobre la key compartida.
    const accountLimit = checkRateLimit(
      `social-rewrite-acct:${accountId}`,
      RATE_LIMITS.aiDraftAccount
    );
    if (!accountLimit.success) return rateLimitResponse(accountLimit);

    const { id } = await params;
    const body = await request.json().catch(() => null);
    const caption =
      typeof body?.caption === 'string' ? body.caption.trim() : '';
    if (!caption) {
      return NextResponse.json({ error: 'Falta el texto' }, { status: 400 });
    }

    // La fila se comprueba para no reescribir sobre algo ajeno o ya
    // publicado; la RLS ya acota a la cuenta.
    const { data: post, error } = await supabase
      .from('social_posts')
      .select('id, network')
      .eq('account_id', accountId)
      .eq('id', id)
      .eq('status', 'pending')
      .maybeSingle<{ id: string; network: string }>();
    if (error) {
      console.error('[social/rewrite] lookup error:', error);
      return NextResponse.json(
        { error: 'No se pudo cargar la publicación' },
        { status: 500 }
      );
    }
    if (!post) {
      return NextResponse.json(
        { error: 'Esa publicación ya no está pendiente' },
        { status: 409 }
      );
    }

    const adapter = networkAdapter(post.network);
    if (!adapter) {
      return NextResponse.json(
        { error: 'Esa publicación va a una red que el sistema ya no maneja' },
        { status: 409 }
      );
    }

    const config = await loadAiConfig(supabase, accountId).catch((err) => {
      console.error('[social/rewrite] loadAiConfig error:', err);
      throw new AiError('Stored API key could not be decrypted.', {
        code: 'key_decrypt_failed',
        status: 400,
      });
    });
    if (!config) {
      return NextResponse.json(
        {
          error:
            'La IA no está configurada en esta cuenta. El texto de la plantilla se puede editar a mano.',
          code: 'ai_not_configured',
        },
        { status: 400 }
      );
    }

    const { text, usage } = await generateReply({
      config,
      systemPrompt: buildRewritePrompt(adapter),
      messages: [{ role: 'user', content: caption }],
    });

    // Consumo de la key BYO de la cuenta. Best-effort y sin esperar,
    // igual que en /api/ai/draft: no puede demorar ni tumbar algo que
    // la persona está esperando.
    try {
      void logAiUsage(supabaseAdmin(), {
        accountId,
        conversationId: null,
        mode: 'social_caption',
        provider: config.provider,
        model: config.model,
        usage,
      });
    } catch (logErr) {
      console.error('[social/rewrite] usage log skipped:', logErr);
    }

    return NextResponse.json({ caption: text.trim() });
  } catch (err) {
    if (err instanceof AiError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.status }
      );
    }
    return toErrorResponse(err);
  }
}
