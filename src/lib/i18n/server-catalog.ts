/**
 * El catálogo de mensajes de la instalación, leído fuera de una petición.
 *
 * Deliberadamente NO `getTranslations()` de next-intl/server: el bot y
 * el aviso de traspaso corren dentro del `after()` del webhook, fuera del
 * alcance de la petición que lo provee. El idioma sale del entorno, igual
 * que en `src/i18n/request.ts`.
 *
 * Devuelve `null` si el catálogo no se puede leer: cada llamador tiene su
 * propio texto de respaldo, porque un despliegue roto no puede dejar a un
 * cliente sin mensaje.
 */
export async function loadServerCatalog(): Promise<Record<string, unknown> | null> {
  const locale = process.env.NEXT_PUBLIC_APP_LOCALE || 'en'
  try {
    return (await import(`../../../messages/${locale}.json`)).default as Record<string, unknown>
  } catch {
    return null
  }
}

/** Una sección del catálogo (`Handoff`, `AiReply`…) o `null`. */
export async function loadCatalogSection(
  section: string,
): Promise<Record<string, unknown> | null> {
  const catalog = await loadServerCatalog()
  const value = catalog?.[section]
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
}
