"use client";

import { useCallback, useEffect, useState } from "react";

import {
  currentPermission,
  fetchPushConfig,
  forgetThisDevice,
  getCurrentSubscription,
  readPushEnvironment,
  resyncSubscription,
  sendTestPush,
  subscribeThisDevice,
  type TestPushResult,
} from "@/lib/push/browser";
import {
  detectPushSupport,
  pushCardState,
  unblockHelpKey,
  type PushCardState,
  type UnblockHelpKey,
} from "@/lib/push/client";

export type EnableResult = "enabled" | "dismissed" | "blocked" | "failed";

export interface PushSubscriptionState {
  /** `null` mientras se revisa el dispositivo. */
  state: PushCardState | null;
  unblockKey: UnblockHelpKey;
  busy: boolean;
  enable: () => Promise<EnableResult>;
  disable: () => Promise<boolean>;
  sendTest: (title: string, body: string) => Promise<TestPushResult>;
}

/**
 * Estado de los avisos push de ESTE dispositivo y sus acciones.
 *
 * Al montar solo lee: nunca pide permiso. El permiso se pide dentro de
 * `enable()`, que la tarjeta llama desde el clic del botón (los
 * navegadores bloquean o penalizan pedirlo sin gesto del usuario).
 *
 * Si el permiso ya está concedido y existe la suscripción, la vuelve a
 * registrar en el servidor: cubre que otro usuario haya iniciado sesión
 * en este navegador o que la fila se haya limpiado.
 */
export function usePushSubscription(): PushSubscriptionState {
  const [state, setState] = useState<PushCardState | null>(null);
  const [unblockKey, setUnblockKey] = useState<UnblockHelpKey>("generic");
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const env = readPushEnvironment();
    setUnblockKey(unblockHelpKey(env.userAgent));
    const support = detectPushSupport(env);
    if (support !== "supported") {
      setState(pushCardState({ support, serverEnabled: true, permission: "default", subscribed: false }));
      return;
    }
    const config = await fetchPushConfig().catch(() => ({ enabled: false, publicKey: null }));
    setPublicKey(config.publicKey);
    const permission = currentPermission();
    let subscribed = false;
    if (config.enabled && permission === "granted") {
      subscribed = (await getCurrentSubscription().catch(() => null)) !== null;
      if (subscribed) await resyncSubscription().catch(() => undefined);
    }
    setState(
      pushCardState({ support, serverEnabled: config.enabled, permission, subscribed }),
    );
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const enable = useCallback(async (): Promise<EnableResult> => {
    if (!publicKey) return "failed";
    setBusy(true);
    try {
      const permission = await subscribeThisDevice(publicKey);
      await refresh();
      if (permission === "granted") return "enabled";
      return permission === "denied" ? "blocked" : "dismissed";
    } catch (err) {
      console.error("[push] enable failed:", err);
      await refresh();
      return "failed";
    } finally {
      setBusy(false);
    }
  }, [publicKey, refresh]);

  const disable = useCallback(async () => {
    setBusy(true);
    try {
      await forgetThisDevice();
      await refresh();
      return true;
    } catch {
      return false;
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const sendTest = useCallback(
    async (title: string, body: string) => {
      setBusy(true);
      try {
        const r = await sendTestPush(title, body).catch(() => "failed" as const);
        if (r === "expired") await refresh();
        return r;
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  return { state, unblockKey, busy, enable, disable, sendTest };
}
