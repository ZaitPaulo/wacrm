"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { canAccessPath, homeForRole } from "@/lib/auth/route-access";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { AccountAccessAlert } from "@/components/layout/account-access-alert";
import { PresenceHeartbeat } from "@/components/presence/presence-heartbeat";

// Auth-gated dashboard shell. Extracted from the layout so the layout
// itself can stay a server component and export metadata (noindex) —
// client components can't export Next's metadata object.

function DashboardShellInner({ children }: { children: React.ReactNode }) {
  const { user, loading, profileLoading, accountRole } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  // ¿Este rol puede estar en esta ruta? Mientras el perfil carga no lo
  // sabemos, así que `canAccessPath` responde que no para todo lo
  // admin-only y más abajo mostramos el spinner en vez del contenido:
  // preferimos un parpadeo de carga a un destello del panel para un
  // agente. Las rutas que no están en la lista pasan de largo, así que
  // esto no le agrega latencia percibida a la bandeja ni a contactos.
  const allowed = canAccessPath(pathname, accountRole);

  // Sidebar drawer state — only used on mobile. On lg+ the sidebar is
  // always visible and this stays at `false` (ignored by the component).
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const closeSidebar = useCallback(() => setSidebarOpen(false), []);

  useEffect(() => {
    if (!loading && !user) {
      router.push("/login");
    }
  }, [user, loading, router]);

  // Rebote por rol. Espera a que el perfil resuelva — si no, el redirect
  // dispararía con `accountRole` todavía en null y sacaría del panel
  // también a los admin. `replace` y no `push` para no dejar la ruta
  // prohibida en el historial: el botón "atrás" volvería a rebotar.
  useEffect(() => {
    if (loading || profileLoading || !user) return;
    if (!allowed) {
      router.replace(homeForRole(accountRole));
    }
  }, [loading, profileLoading, user, allowed, accountRole, router]);

  // El mismo spinner cubre dos casos: la sesión todavía cargando, y una
  // ruta admin-only mientras se decide o se ejecuta el rebote. En el
  // segundo es lo que impide que el panel se pinte por un frame antes
  // de que el redirect se haga efectivo.
  if (loading || !allowed) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Reports this tab's online/away presence once we know a user is
          signed in. Headless — renders nothing. */}
      <PresenceHeartbeat />
      <Sidebar open={sidebarOpen} onClose={closeSidebar} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header onOpenSidebar={() => setSidebarOpen(true)} />
        {/* Thinner horizontal padding on mobile so cards have room to breathe. */}
        <main className="flex-1 overflow-y-auto p-4 sm:p-6">
          {/* Above every page: writes are being rejected and here's why.
              Renders nothing unless the account/role failed to resolve. */}
          <AccountAccessAlert />
          {children}
        </main>
      </div>
    </div>
  );
}

/**
 * Envoltorio de todas las pantallas del dashboard: provee el contexto de
 * autenticación y monta el chrome (sidebar, header, presencia).
 *
 * Es además el punto único donde se aplica el control de acceso por rol,
 * porque toda ruta del grupo `(dashboard)` pasa por acá — de ahí que las
 * páginas individuales no necesiten su propio guard.
 */
export function DashboardShell({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <DashboardShellInner>{children}</DashboardShellInner>
    </AuthProvider>
  );
}
