// ============================================================
// El origen publicitario de un mensaje (migración 526).
//
// Cuando alguien toca un anuncio de Meta con clic a WhatsApp, el primer
// mensaje trae `referral`. Lo que llega es de un tercero y su forma puede
// cambiar: se guardan solo los campos conocidos, como texto y con tope,
// para que un payload inesperado no termine tal cual en la base ni en el
// prompt del bot.
// ============================================================

/** Campos del `referral` de Meta que se conservan. */
const REFERRAL_FIELDS = [
  'source_url',
  'source_id',
  'source_type',
  'headline',
  'body',
  'media_type',
  'image_url',
  'video_url',
  'thumbnail_url',
  'ctwa_clid',
] as const

type ReferralField = (typeof REFERRAL_FIELDS)[number]

export type AdReferral = Partial<Record<ReferralField, string>>

/** Tope por campo: el texto de un anuncio es corto; más que esto es ruido. */
const MAX_FIELD_LEN = 1000

/**
 * El referral saneado, o null cuando no hay ninguno o no trae nada
 * reconocible. Un referral parcial se conserva con lo que traiga.
 */
export function parseAdReferral(raw: unknown): AdReferral | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const source = raw as Record<string, unknown>

  const out: AdReferral = {}
  for (const field of REFERRAL_FIELDS) {
    const value = source[field]
    if (typeof value === 'string' && value.trim() !== '') {
      out[field] = value.slice(0, MAX_FIELD_LEN)
    }
  }
  return Object.keys(out).length > 0 ? out : null
}
