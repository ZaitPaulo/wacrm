// ============================================================
// Código de referencia del vehículo en el mensaje de WhatsApp.
//
// Módulo PURO y compartido por los dos extremos de la cadena:
//   vitrina  → `formatRefTag()`  escribe el código en el CTA
//   webhook  → `parseRefTag()`   lo reconoce en el mensaje entrante
//
// Tenerlo en un solo archivo es lo que garantiza que ambos lados hablen
// del mismo formato: si el tag cambia, cambia para los dos a la vez.
//
// El código lo genera la base (`generate_vehicle_public_ref()`, migración
// 508); aquí sólo se le da forma y se lo vuelve a extraer.
// ============================================================

/**
 * Alfabeto del código, sin caracteres que se confundan al leerlos o
 * teclearlos: sin 0/O, sin 1/I/L, sin U (se parece a V en mayúsculas).
 * Debe coincidir con el de `generate_vehicle_public_ref()` en SQL.
 */
const REF_CHARS = '2-9A-HJKMNP-TV-Z'
const REF_LENGTH = 6

/**
 * Reconoce `[Ref: X7K2M9]` en un texto.
 *
 * Deliberadamente tolerante: el cliente puede reenviar el mensaje, citarlo
 * o escribir alrededor, y el código debe seguir reconociéndose. Se aceptan
 * mayúsculas o minúsculas y espacios extra dentro del corchete.
 *
 * NO es tolerante con el código en sí: seis caracteres del alfabeto, ni
 * más ni menos. Aceptar variantes invitaría a falsos positivos, y una
 * atribución equivocada es peor que ninguna.
 */
const REF_PATTERN = new RegExp(
  `\\[\\s*ref\\s*:\\s*([${REF_CHARS}]{${REF_LENGTH}})\\s*\\]`,
  'i',
)

/** Etiqueta lista para pegar al final del mensaje del CTA. */
export function formatRefTag(publicRef: string): string {
  return `[Ref: ${publicRef.toUpperCase()}]`
}

/**
 * Extrae el código de referencia de un mensaje entrante.
 *
 * @returns el código en mayúsculas, o `null` si el texto no lo trae.
 *   `null` es un resultado normal, no un error: el cliente pudo borrar
 *   la etiqueta antes de enviar, o escribir por su cuenta. En ese caso
 *   no se atribuye nada — nunca se adivina por cercanía temporal.
 */
export function parseRefTag(text: string | null | undefined): string | null {
  if (!text) return null
  const match = REF_PATTERN.exec(text)
  return match ? match[1].toUpperCase() : null
}
