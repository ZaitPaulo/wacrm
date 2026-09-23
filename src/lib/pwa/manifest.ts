import type { Metadata, MetadataRoute } from 'next'

// ============================================================
// El CRM como aplicación instalable (PWA).
//
// El manifest NO usa la convención `src/app/manifest.ts` de Next a
// propósito: esa convención lo enlaza en TODAS las páginas, vitrina
// pública incluida, y Chrome podría ofrecerle "instalar el CRM" a un
// comprador de carros. Se sirve desde `src/app/app.webmanifest/route.ts`
// y se enlaza solo desde los layouts del CRM y del login.
//
// Instalarlo importa sobre todo en iPhone: Safari solo entrega avisos
// push a un sitio agregado a la pantalla de inicio (iOS 16.4+).
// ============================================================

export const CRM_MANIFEST_PATH = '/app.webmanifest'

export function buildCrmManifest(opts: {
  appName: string
  description: string
}): MetadataRoute.Manifest {
  return {
    id: '/inbox',
    name: `${opts.appName} CRM`,
    short_name: opts.appName,
    description: opts.description,
    start_url: '/inbox',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#000000',
    theme_color: '#020617',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      {
        src: '/icons/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  }
}

/** Metadatos que los layouts del CRM y del login agregan. El icono de
 *  la pantalla de inicio de iPhone sale de `src/app/apple-icon.png`
 *  (convención de archivo de Next). */
export function crmPwaMetadata(appName: string): Pick<Metadata, 'manifest' | 'appleWebApp'> {
  return {
    manifest: CRM_MANIFEST_PATH,
    appleWebApp: {
      capable: true,
      title: appName,
      statusBarStyle: 'black',
    },
  }
}
