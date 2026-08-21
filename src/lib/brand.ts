// ============================================================
// Nombre público del producto.
//
// Vive en código y no en los catálogos de next-intl a propósito: una
// marca no se traduce, así que los tres idiomas tienen que renderizar
// exactamente la misma palabra. Tenerlo en `messages/*.json` invitaba a
// que un idioma quedara con el nombre viejo (que es justo lo que pasó:
// `en`/`ko` seguían diciendo "CRM Template for WhatsApp" mucho después
// de que `es` ya se hubiera renombrado).
//
// Este es el único lugar donde cambiarlo si el despliegue se rebrandea.
// ============================================================

/** Nombre visible del producto: pestaña del navegador, sidebar, OG tags. */
export const APP_NAME = 'LoraMotors'
