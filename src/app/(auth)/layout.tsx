import type { Metadata } from "next";
import type { ReactNode } from "react";
import { APP_NAME } from "@/lib/brand";
import { crmPwaMetadata } from "@/lib/pwa/manifest";

// Shared metadata for auth pages (login / signup / forgot-password).
// None of these should be indexed — they'd compete with the marketing
// landing in SERPs and offer nothing to a searcher who hasn't already
// signed up. Each page still gets its own <title> via its own
// metadata.title override below the route group layout.
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

export default function AuthLayout({ children }: { children: ReactNode }) {
  return children;
}
