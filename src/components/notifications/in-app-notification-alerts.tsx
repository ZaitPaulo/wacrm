"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase/client";
import {
  closeConversationSystemNotifications,
  currentPermission,
  getCurrentSubscription,
  playChime,
} from "@/lib/push/browser";
import {
  isApplePushUserAgent,
  shouldAlertInApp,
  viewedConversationId,
  type AlertableRow,
} from "@/lib/push/client";
import type { Notification } from "@/types";

/**
 * Avisos con el CRM abierto. Sin interfaz propia: vive en el shell del
 * dashboard, así funciona en cualquier pantalla.
 *
 * 1. Aviso emergente + sonido por cada aviso nuevo del usuario (o cada
 *    mensaje nuevo que refresca uno), llegado por Realtime. No depende
 *    del push: funciona aunque este dispositivo no haya activado los
 *    avisos del sistema. El service worker, por su lado, no muestra el
 *    del sistema si hay una pestaña visible, así que no se duplican.
 * 2. Tocar un aviso del sistema con el CRM abierto: el service worker
 *    enfoca esta pestaña y manda `{type:'navigate'}`; aquí se navega con
 *    el router, sin recargar.
 * 3. Abrir una conversación en la bandeja marca leídos sus avisos de
 *    mensaje nuevo y cierra su aviso del sistema en este dispositivo.
 */
export function InAppNotificationAlerts() {
  const t = useTranslations("Notifications.inApp");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const viewing = viewedConversationId(pathname, searchParams.size ? `?${searchParams.toString()}` : "");

  // El canal de Realtime se abre una sola vez; lo que cambia entre
  // renders se lee de refs.
  const viewingRef = useRef<string | null>(viewing);
  const suppressRef = useRef(false);
  const tRef = useRef(t);
  const routerRef = useRef(router);
  useEffect(() => {
    viewingRef.current = viewing;
    tRef.current = t;
    routerRef.current = router;
  });

  // Safari/iOS con avisos activos en este dispositivo: el aviso del
  // sistema sale siempre (Apple lo exige), así que la app no duplica.
  useEffect(() => {
    if (!isApplePushUserAgent(navigator.userAgent)) return;
    if (currentPermission() !== "granted") return;
    getCurrentSubscription()
      .then((sub) => {
        suppressRef.current = sub !== null;
      })
      .catch(() => undefined);
  }, []);

  // (3) Abrir la conversación limpia sus avisos.
  useEffect(() => {
    if (!viewing) return;
    void closeConversationSystemNotifications(viewing);
    const supabase = createClient();
    void supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("conversation_id", viewing)
      .eq("type", "new_message")
      .is("read_at", null)
      .then(({ error }) => {
        if (error) console.error("[notifications] mark conversation read:", error.message);
      });
  }, [viewing]);

  // (2) Navegación pedida por el service worker.
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; url?: string } | null;
      if (data?.type === "navigate" && typeof data.url === "string" && data.url.startsWith("/")) {
        routerRef.current.push(data.url);
      }
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, []);

  // (1) Aviso emergente + sonido.
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("notifications-in-app-alerts")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications" },
        (payload) => {
          if (payload.eventType !== "INSERT" && payload.eventType !== "UPDATE") return;
          const row = payload.new as Notification;
          const decision = shouldAlertInApp({
            eventType: payload.eventType,
            row: row as AlertableRow,
            oldCreatedAt: (payload.old as Partial<Notification> | null)?.created_at,
            visible: document.visibilityState === "visible",
            viewingConversationId: viewingRef.current,
            suppressForSystemAlert: suppressRef.current,
            now: Date.now(),
          });

          if (decision === "mark-read") {
            void supabase
              .from("notifications")
              .update({ read_at: new Date().toISOString() })
              .eq("id", row.id)
              .is("read_at", null)
              .then(() => undefined);
            return;
          }
          if (decision !== "alert") return;

          playChime();
          const url = row.conversation_id ? `/inbox?c=${row.conversation_id}` : "/notifications";
          // Mismo id por conversación: los mensajes seguidos reemplazan el
          // aviso emergente en vez de apilarlo, igual que el del sistema.
          toast(row.title, {
            id: row.conversation_id ? `conversation-${row.conversation_id}` : row.id,
            description: row.body ? row.body.split("\n")[0] : undefined,
            duration: 8000,
            action: {
              label: tRef.current("open"),
              onClick: () => routerRef.current.push(url),
            },
          });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  return null;
}
