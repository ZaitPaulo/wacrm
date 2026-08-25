import type { Metadata, Viewport } from "next";
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages, getTranslations } from 'next-intl/server';
import { Inter } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import { ThemeProvider } from "@/hooks/use-theme";
import { ThemedToaster } from "@/components/themed-toaster";
import { APP_NAME } from "@/lib/brand";
import { configuredBaseUrl } from "@/lib/showcase/site-url";
import {
  DEFAULT_MODE,
  DEFAULT_THEME,
  MODE_STORAGE_KEY,
  MODES,
  STORAGE_KEY,
  THEME_IDS,
} from "@/lib/themes";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
});

// `metadataBase` resuelve a URL absoluta todo campo de metadata que sea
// una ruta relativa — y el `og:image` que Next genera desde los archivos
// `opengraph-image.tsx` es uno de ellos. Sin esta base, en un despliegue
// propio (sin las VERCEL_* que Next usa de respaldo) el og:image sale
// como `http://localhost:3000/...`, que ningún crawler externo puede
// descargar: así es como los enlaces compartidos por WhatsApp quedaban
// sin miniatura. Ver node_modules/next/dist/lib/metadata/resolvers/resolve-url.js.
//
// Se lee de NEXT_PUBLIC_SITE_URL y no del request porque `headers()` en
// el layout raíz volvería dinámica toda la app. Las rutas que necesitan
// funcionar aunque la variable falte (p. ej. /join) declaran su propia
// `metadataBase` derivada del request.
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Brand");

  return {
    metadataBase: configuredBaseUrl(),
    title: {
      default: APP_NAME,
      template: `%s — ${APP_NAME}`,
    },
    description: t("description"),
    applicationName: APP_NAME,
    robots: {
      index: false,
      follow: false,
    },
    // El icono NO se declara aquí a propósito: `src/app/icon.png` es una
    // convención de archivo y Next inyecta su <link rel="icon"> solo, con
    // el hash de contenido en la URL. Declararlo a mano apuntaba a
    // `/icon`, la ruta que servía el `icon.tsx` generado que ya no existe,
    // y ahora sería un 404 pisando al icono bueno.
    formatDetection: {
      email: false,
      address: false,
      telephone: false,
    },
  };
}

export const viewport: Viewport = {
  themeColor: "#020617",
  colorScheme: "dark light",
};

// Inline boot script — runs before React hydrates so the user's
// chosen accent (data-theme) AND mode (data-mode) are on the <html>
// element before first paint. Without this every page load flashes
// the server-rendered defaults for a frame before the React tree
// mounts and applies the picked values.
//
// Kept dependency-free (no imports, no JSX) — must be a string the
// browser can run as a single <script>. Knowledge of valid ids is
// sourced from the THEME_IDS / MODES constants so adding one doesn't
// silently break the boot path.
const THEME_BOOT_SCRIPT = `
(function(){
  var d = document.documentElement;
  try {
    var THEME_KEY = ${JSON.stringify(STORAGE_KEY)};
    var THEME_DEFAULT = ${JSON.stringify(DEFAULT_THEME)};
    var THEMES = ${JSON.stringify(THEME_IDS)};
    var savedTheme = localStorage.getItem(THEME_KEY);
    d.dataset.theme = THEMES.indexOf(savedTheme) !== -1 ? savedTheme : THEME_DEFAULT;

    var MODE_KEY = ${JSON.stringify(MODE_STORAGE_KEY)};
    var MODE_DEFAULT = ${JSON.stringify(DEFAULT_MODE)};
    var MODES = ${JSON.stringify(MODES)};
    var savedMode = localStorage.getItem(MODE_KEY);
    d.dataset.mode = MODES.indexOf(savedMode) !== -1 ? savedMode : MODE_DEFAULT;
  } catch (_e) {
    d.dataset.theme = ${JSON.stringify(DEFAULT_THEME)};
    d.dataset.mode = ${JSON.stringify(DEFAULT_MODE)};
  }
})();
`;

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html
      lang={locale}
      data-theme={DEFAULT_THEME}
      data-mode={DEFAULT_MODE}
      className={`${inter.variable} h-full antialiased`}
      // The `theme-boot` script below rewrites `data-theme` and
      // `data-mode` on <html> from localStorage before React hydrates,
      // so for any non-default choice the client DOM intentionally
      // differs from the server-rendered defaults. suppressHydration-
      // Warning silences the expected mismatch — it only applies to
      // this element's own attributes, so genuine mismatches in
      // children still surface.
      suppressHydrationWarning
    >
      <head>
        <Script
          id="theme-boot"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }}
        />
      </head>
      <body className="min-h-full bg-background text-foreground font-sans">
        <NextIntlClientProvider messages={messages} locale={locale}>
          <ThemeProvider>
            {children}
            <ThemedToaster />
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
