// ============================================================
// /join/[token] layout — minimal full-bleed dark shell.
//
// The route group sits outside both `(auth)` and `(dashboard)`
// because it's hybrid: the page must render for anonymous
// visitors (to show "Sign up to join Acme") *and* for signed-in
// users (to show "Accept invite"). Reusing `(auth)`'s layout
// would funnel signed-in users through the middleware's auth-
// page redirect; reusing `(dashboard)` would funnel anonymous
// visitors through its login redirect. A dedicated layout
// avoids both.
//
// Styling matches the login / signup pages — centered card on a
// slate-950 background — so the join experience feels like a
// natural step in the auth funnel rather than a foreign page.
//
// Referrer-Policy: no-referrer
//   The plaintext invite token lives in the URL path. Without
//   this header, any externally-loaded resource (third-party
//   font, CDN script, image) would receive the full join URL in
//   its `Referer` header. The /join page doesn't currently load
//   anything external, but `Referrer-Policy: no-referrer` is a
//   cheap belt-and-braces guard against future regressions
//   accidentally leaking tokens. Per Next.js 16's `metadata`
//   export, this surfaces as `<meta name="referrer" content="no-referrer">`.
// ============================================================

import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';

import { APP_NAME } from '@/lib/brand';
import { getBaseUrl } from '@/lib/showcase/site-url';

// Metadata propia del embudo de invitación.
//
// Sin esto, la tarjeta que arma WhatsApp al compartir un /join/<token>
// heredaba el título y la descripción del layout raíz — le anunciaba al
// invitado el nombre del producto y nada sobre la invitación.
//
// `metadataBase` se deriva del request y no de NEXT_PUBLIC_SITE_URL: es
// el `og:image` de esta ruta el que más importa que resuelva a URL
// absoluta, y estos enlaces se comparten precisamente en despliegues
// recién montados donde la variable todavía puede faltar. La ruta ya es
// dinámica (`[token]`), así que leer headers acá no cuesta nada.
export async function generateMetadata(): Promise<Metadata> {
  const [t, base] = await Promise.all([
    getTranslations('JoinPage'),
    getBaseUrl(),
  ]);

  const title = t('metaTitle', { brand: APP_NAME });
  const description = t('metaDescription');

  return {
    metadataBase: new URL(base),
    // `absolute` evita que la plantilla del layout raíz le pegue otra
    // vez el nombre de la marca detrás del título.
    title: { absolute: title },
    description,
    referrer: 'no-referrer',
    // Belt-and-braces against an invite URL ending up in search
    // results if a join page is ever crawled.
    robots: { index: false, follow: false },
    // El og:image lo aporta join/[token]/opengraph-image.tsx.
    openGraph: {
      title,
      description,
      siteName: APP_NAME,
      type: 'website',
    },
    twitter: { card: 'summary_large_image', title, description },
  };
}

export default function JoinLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      {children}
    </div>
  );
}
