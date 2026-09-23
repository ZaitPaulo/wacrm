import type { AccountRole } from '@/lib/auth/roles'

/**
 * Quién puede cambiar la asignación de una conversación, en código.
 *
 * POR QUÉ ESTA REGLA VIVE EN TYPESCRIPT Y NO SOLO EN LA BASE
 *
 * La migración 520 la puso donde corresponde: la RLS decide quién ve la
 * conversación y el trigger `enforce_agent_keeps_assignment` decide
 * quién puede dejarla sin asignar. Con el cliente de sesión eso basta y
 * sigue vigente.
 *
 * Pero hay dos operaciones que la RLS NO puede dejar pasar y que el
 * negocio sí quiere permitir —devolverle el hilo al bot y pasárselo a un
 * compañero—, porque las dos terminan en una fila que el propio asesor
 * ya no puede ver, y la política de SELECT de `conversations` se aplica
 * también a la fila resultante de un UPDATE. Verificado contra la base
 * de producción el 2026-09-21 como `authenticated` con el JWT de un
 * `agent`:
 *
 *   ERROR: new row violates row-level security policy for table "conversations"
 *
 * Relajar esa política no es opción: abriría las 121 conversaciones sin
 * asignar a los tres asesores, que es exactamente lo que la 520 fue a
 * cerrar. Así que esas dos operaciones pasan a hacerse con el cliente de
 * service-role, y eso APAGA los dos controles de la base a la vez: la
 * RLS y el trigger, porque el trigger se abstiene cuando `auth.uid()` es
 * NULL.
 *
 * De ahí este archivo. Lo que la base ya no puede comprobar se comprueba
 * acá, con las mismas reglas y en un solo sitio para que los dos
 * endpoints no puedan divergir:
 *
 *   - un `agent` manda sobre la conversación que tiene asignada, y solo
 *     sobre esa;
 *   - `admin` y `owner` mandan sobre cualquiera de su cuenta;
 *   - dejar una conversación sin asignar sigue siendo cosa de
 *     `admin`/`owner`, salvo el caso concreto de devolvérsela al bot.
 *
 * Son funciones puras a propósito: la parte que decide se prueba sin
 * base de datos ni HTTP, y los endpoints solo la aplican.
 */

/** Roles que mandan sobre cualquier conversación de su cuenta. */
const ROLES_QUE_ADMINISTRAN: readonly AccountRole[] = ['owner', 'admin']

/**
 * ¿Es `owner` o `admin`? Quien administra puede reasignar, soltar y
 * devolver al bot cualquier conversación de su cuenta, y escribe siempre
 * con su sesión (ver `escribeConServiceRole`).
 */
export function administra(role: AccountRole): boolean {
  return ROLES_QUE_ADMINISTRAN.includes(role)
}

/**
 * ¿Puede quien llama tocar la asignación de esta conversación?
 *
 * Un `agent` solo si ya es el asignado. Que no pueda tomar una
 * conversación sin dueño no es un olvido: es la regla de la 520, que
 * deja el reparto de lo no asignado en manos del admin. Y en la práctica
 * ni llega hasta acá, porque la lectura previa —que sí va con el cliente
 * de sesión— no se la devuelve.
 *
 * `viewer` no pasa nunca: es un rol de supervisión de solo lectura.
 */
export function puedeCambiarAsignacion(args: {
  role: AccountRole
  userId: string
  currentAssigneeId: string | null
}): boolean {
  if (administra(args.role)) return true
  if (args.role !== 'agent') return false
  return args.currentAssigneeId !== null && args.currentAssigneeId === args.userId
}

/**
 * ¿Puede quien llama dejar la conversación SIN asignar?
 *
 * Es la regla del trigger de la 520, reescrita para el camino de
 * service-role: un asesor puede pasarle la conversación a otro miembro,
 * pero no soltarla — eso la mandaría al limbo que solo ve el admin, y
 * sería la forma fácil de zafarse de un cliente difícil.
 *
 * `devolverAlBot` es la excepción estrecha, y es estrecha porque el
 * cliente no queda sin nadie: queda con el bot, que lo atiende y lo
 * vuelve a traspasar si hace falta. Quién decide si una operación ES una
 * devolución al bot es {@link esDevolucionAlBot}, no quien llama.
 *
 * Esta excepción vivió un tiempo en la base (una migración 530 que la
 * añadía al trigger de la 520) y se descartó antes de desplegarse: el
 * trigger nunca era el que frenaba al `agent` —lo frena la RLS— y el
 * camino real escribe con service-role, donde el trigger no corre. La
 * regla vive acá y solo acá.
 */
export function puedeDejarSinAsignar(args: {
  role: AccountRole
  devolverAlBot: boolean
}): boolean {
  return administra(args.role) || args.devolverAlBot
}

/**
 * ¿Esta operación le devuelve el hilo al bot, o solo lo suelta?
 *
 * MIRA LA TRANSICIÓN, NO EL ESTADO FINAL. Devolver al bot es la
 * operación que REACTIVA la IA en el hilo: la IA estaba pausada antes
 * (`ai_autoreply_disabled = TRUE`) y queda activa después. Si la IA ya
 * estaba activa, quitar el asesor no le devuelve nada a nadie —el bot
 * ya tenía el hilo—: es soltarlo, y un `agent` no puede.
 *
 * Sin esta distinción, "Reactivar IA" sería una puerta trasera para
 * soltar cualquier hilo propio: el endpoint quita la asignación en todo
 * `paused: false`, y con service-role ni la RLS ni el trigger de la 520
 * lo ven.
 *
 * `iaPausadaAntes` sale de la lectura previa, que va con el cliente de
 * sesión. `null` (la columna vacía, o una lectura que no la trajo) NO
 * cuenta como pausada: ante la duda, el lado seguro es rechazar.
 */
export function esDevolucionAlBot(args: {
  iaPausadaAntes: boolean | null
  iaPausadaDespues: boolean
}): boolean {
  return args.iaPausadaAntes === true && args.iaPausadaDespues === false
}

/**
 * ¿Hay que escribir este cambio con el cliente de service-role, o pasa
 * por el de sesión?
 *
 * LA PREGUNTA REAL ES SI LA FILA RESULTANTE LE SIGUE SIENDO VISIBLE A
 * QUIEN ESCRIBE. La política de SELECT de `conversations` (migración
 * 520) se aplica también a la fila que deja un UPDATE, así que un
 * `agent` que termina sin la conversación asignada se la deja invisible
 * a sí mismo en la misma sentencia y la RLS aborta con
 * `new row violates row-level security policy`. `admin` y `owner` ven
 * toda la cuenta, así que para ellos la fila nunca desaparece.
 *
 * POR QUÉ NO SE USA SERVICE-ROLE SIEMPRE, QUE SERÍA MÁS CORTO
 *
 * Por el aviso al asignado. `notify_conversation_assigned` (migración
 * 527) nombra a quien reasignó leyendo `auth.uid()`, y con service-role
 * eso es NULL. Medido contra la base de producción:
 *
 *   con sesión de un admin → "Angelica Maria Molero te asignó una
 *                             conversación con Juan"
 *   con service-role       → "Se te asignó una conversación con Juan"
 *
 * Hoy los `admin` reasignan sin problema —la RLS les deja— y reciben el
 * aviso con nombre. Mandarlos por service-role "para tener un solo
 * camino" les quitaría esa información sin que nadie lo pidiera. Los
 * `agent` no pierden nada: hasta ahora directamente no podían reasignar.
 *
 * O sea: se sale del camino normal SOLO quien no cabe en él. Si alguien
 * viene a simplificar esto a una sola rama, esto es lo que degrada.
 *
 * `viewer` no llega nunca hasta acá —{@link puedeCambiarAsignacion} lo
 * rechaza antes—, pero si llegara se trataría como un `agent`, que es el
 * lado seguro.
 */
export function escribeConServiceRole(args: {
  role: AccountRole
  userId: string
  /** A quién queda asignada la conversación DESPUÉS del cambio. */
  nuevoAsignado: string | null
}): boolean {
  if (administra(args.role)) return false
  return args.nuevoAsignado !== args.userId
}

/**
 * ¿Es válido el destinatario de una reasignación?
 *
 * Con el cliente de sesión esto lo cubría la RLS de rebote; con
 * service-role hay que mirarlo, y hace falta de verdad:
 * `conversations.assigned_agent_id` NO tiene clave ajena contra
 * `auth.users` ni contra `profiles`, así que sin esta comprobación un
 * asesor podría escribir ahí el UUID que se le antoje —el de otra
 * cuenta, o uno inventado— y la conversación quedaría asignada a nadie
 * sin que la base dijera una palabra.
 *
 * `miembros` son los `user_id` de los perfiles de la cuenta de quien
 * llama. `null` es soltar, y eso lo decide {@link puedeDejarSinAsignar}.
 */
export function destinatarioValido(args: {
  targetUserId: string | null
  miembros: readonly string[]
}): boolean {
  if (args.targetUserId === null) return true
  return args.miembros.includes(args.targetUserId)
}
