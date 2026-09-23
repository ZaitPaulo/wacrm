import type { Metadata } from "next";
import { DashboardShell } from "./dashboard-shell";
import { APP_NAME } from "@/lib/brand";
import { crmPwaMetadata } from "@/lib/pwa/manifest";

// Server layout whose only job is to declare "do not index" metadata
// for the authed app. robots.ts already disallows these paths at the
// crawler-level and middleware redirects unauthenticated visitors, so
// this is belt-and-suspenders — but SEO-critical if a URL ever leaks
// via a link shared externally.
export const metadata: Metadata = {
  // El CRM es instalable (PWA): en iPhone es la única forma de recibir
  // avisos push. Solo aquí y no en el layout raíz, para que la vitrina
  // pública no se ofrezca como "instalar el CRM".
  ...crmPwaMetadata(APP_NAME),
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: {
      index: false,
      follow: false,
      noimageindex: true,
    },
  },
};

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <DashboardShell>{children}</DashboardShell>;
}
