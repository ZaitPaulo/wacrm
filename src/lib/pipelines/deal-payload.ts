// ============================================================
// Campos que distinguen el alta de un negocio de su edición.
//
// Vive acá, junto a `deal-vehicle.ts` y `deal-errors.ts`, por lo mismo
// que ellos: es lógica pura y se prueba sin montar el formulario.
//
// El motivo de fondo es que `conversation_id` NO puede estar en el
// payload compartido entre alta y edición. Repisar el vínculo de un
// negocio que ya existe es otra decisión —y además el índice único
// parcial de la migración 532 haría fallar la edición de un negocio
// abierto cuya conversación ya tiene otro—. Encerrar el campo en una
// función que solo usa el alta lo vuelve difícil de mezclar por
// descuido; si algún día alguien lo necesita en la edición, tiene que
// escribirlo a propósito.
// ============================================================

/** Lo mínimo que hace falta de la conversación: su id. */
export interface LinkableConversation {
  id: string;
}

/** Campos que solo lleva el `insert` de un negocio nuevo. */
export interface NewDealFields {
  user_id: string;
  account_id: string;
  status: "open";
  conversation_id: string | null;
}

/**
 * Arma los campos exclusivos del alta de un negocio.
 *
 * `conversation_id` sale de la conversación que el formulario ya tiene
 * cargada para el contacto —la más reciente por `last_message_at`—. Sin
 * ella el negocio nacía desvinculado, y de ahí venían dos problemas: el
 * spec `inbox-deal-creation` pide que se cree "con la conversación
 * vinculada", y el índice único parcial de la migración 532
 * —`deals (conversation_id) WHERE status = 'open'`— no puede impedir un
 * segundo negocio abierto sobre el mismo hilo si el campo va en NULL,
 * porque en Postgres dos NULL no colisionan.
 *
 * Cuando no hay conversación va `null`, y eso es legítimo: un contacto
 * cargado a mano o importado por CSV puede no haber escrito nunca. No se
 * inventa un vínculo, y esos negocios siguen sin estorbarse entre sí.
 */
export function newDealFields(input: {
  userId: string;
  accountId: string;
  conversation: LinkableConversation | null | undefined;
}): NewDealFields {
  return {
    user_id: input.userId,
    account_id: input.accountId,
    status: "open",
    conversation_id: input.conversation?.id ?? null,
  };
}
