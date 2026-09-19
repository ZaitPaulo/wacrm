/**
 * La imagen que muestran WhatsApp y las redes al compartir la portada.
 *
 * Vive en `public/` y no como `opengraph-image.jpg` del segmento: servida
 * por la convención de metadatos de Next salía por partes, sin
 * `Content-Length`, y WhatsApp la mostraba en miniatura (2026-09-18). Un
 * archivo de `public/` lleva su tamaño declarado.
 *
 * El nombre lleva versión a propósito: WhatsApp guarda la imagen de cada
 * URL, y cambiar el diseño con el mismo nombre dejaría la vieja en los
 * chats. Al reemplazarla, súbele la versión.
 */
export const STOREFRONT_OG_IMAGE = {
  path: 'og/portada-v3.jpg',
  width: 1200,
  height: 630,
  type: 'image/jpeg',
  alt: 'Lora Motors, comercializadora de autos. Cra. 44 # 63-05, diagonal a La Tiendecita, barrio Boston, Barranquilla.',
} as const
