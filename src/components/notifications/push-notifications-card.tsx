"use client";

import { BellOff, BellRing, Loader2, Send, Smartphone, ShieldAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { usePushSubscription } from "@/hooks/use-push-subscription";
import type { PushCardState, UnblockHelpKey } from "@/lib/push/client";
import { cn } from "@/lib/utils";

interface ViewProps {
  state: PushCardState | null;
  unblockKey: UnblockHelpKey;
  busy: boolean;
  onEnable: () => void;
  onDisable: () => void;
  onTest: () => void;
}

const STATUS_KEY: Record<PushCardState, string> = {
  enabled: "statusEnabled",
  disabled: "statusDisabled",
  blocked: "statusBlocked",
  unsupported: "statusUnsupported",
  "server-disabled": "statusServerDisabled",
  "ios-install": "statusIosInstall",
  "ios-too-old": "statusIosTooOld",
};

/**
 * Tarjeta "Avisos en este dispositivo" — presentación pura.
 *
 * Móvil primero: una columna, botones de 44 px de alto a todo el ancho
 * en el celular y en fila desde `sm`. El estado va en una región
 * `aria-live` para que un lector de pantalla anuncie el cambio al
 * activar o desactivar.
 */
export function PushNotificationsCardView({
  state,
  unblockKey,
  busy,
  onEnable,
  onDisable,
  onTest,
}: ViewProps) {
  const t = useTranslations("Notifications.push");
  const enabled = state === "enabled";
  const warn = state === "blocked" || state === "unsupported" || state === "ios-too-old" || state === "server-disabled";
  const Icon = enabled ? BellRing : state === "ios-install" ? Smartphone : warn ? ShieldAlert : BellOff;

  return (
    <section
      aria-labelledby="push-card-title"
      className="rounded-xl border border-border bg-card p-4 sm:p-5"
    >
      <div className="flex items-start gap-3">
        <div
          aria-hidden
          className={cn(
            "flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg",
            enabled ? "bg-primary/15 text-primary" : warn ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground",
          )}
        >
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 id="push-card-title" className="text-sm font-semibold text-foreground">
            {t("cardTitle")}
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{t("cardDescription")}</p>
          <p
            aria-live="polite"
            className={cn(
              "mt-2 inline-flex items-center gap-1.5 text-xs font-medium",
              enabled ? "text-primary" : warn ? "text-destructive" : "text-foreground",
            )}
          >
            {state === null && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
            {state === null ? t("statusLoading") : t(STATUS_KEY[state])}
          </p>
        </div>
      </div>

      {state === "blocked" && (
        <div className="mt-3 rounded-lg bg-muted/60 p-3 text-xs text-foreground">
          <p>{t("blockedIntro")}</p>
          <p className="mt-1 text-muted-foreground">{t(`unblock.${unblockKey}`)}</p>
        </div>
      )}

      {state === "ios-install" && (
        <div className="mt-3 rounded-lg bg-muted/60 p-3 text-xs text-foreground">
          <p>{t("iosInstallIntro")}</p>
          <ol className="mt-2 list-decimal space-y-1 pl-4 text-muted-foreground">
            <li>{t("iosStep1")}</li>
            <li>{t("iosStep2")}</li>
            <li>{t("iosStep3")}</li>
            <li>{t("iosStep4")}</li>
          </ol>
        </div>
      )}

      {state === "ios-too-old" && <p className="mt-3 text-xs text-muted-foreground">{t("iosTooOldHint")}</p>}
      {state === "unsupported" && <p className="mt-3 text-xs text-muted-foreground">{t("unsupportedHint")}</p>}
      {state === "server-disabled" && <p className="mt-3 text-xs text-muted-foreground">{t("serverDisabledHint")}</p>}

      {state === "disabled" && (
        <div className="mt-4">
          <Button className="h-11 w-full sm:w-auto" disabled={busy} onClick={onEnable}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <BellRing className="h-4 w-4" aria-hidden />}
            {busy ? t("enabling") : t("enable")}
          </Button>
        </div>
      )}

      {enabled && (
        <>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <Button className="h-11 w-full sm:w-auto" disabled={busy} onClick={onTest}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
              {busy ? t("sendingTest") : t("sendTest")}
            </Button>
            <Button variant="outline" className="h-11 w-full sm:w-auto" disabled={busy} onClick={onDisable}>
              <BellOff className="h-4 w-4" aria-hidden />
              {t("disable")}
            </Button>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">{t("enabledHint")}</p>
        </>
      )}

      {/* Siempre visible, salvo cuando la tarjeta ya está explicando lo de
          iPhone con los pasos completos: la limitación de Apple no se
          esconde. */}
      {state !== "ios-install" && state !== null && (
        <p className="mt-3 border-t border-border pt-3 text-[11px] text-muted-foreground">
          {t("iphoneNote")}
        </p>
      )}
    </section>
  );
}

/** Tarjeta conectada: estado real del dispositivo y avisos de resultado. */
export function PushNotificationsCard() {
  const t = useTranslations("Notifications.push");
  const { state, unblockKey, busy, enable, disable, sendTest } = usePushSubscription();

  return (
    <PushNotificationsCardView
      state={state}
      unblockKey={unblockKey}
      busy={busy}
      onEnable={async () => {
        const r = await enable();
        if (r === "enabled") toast.success(t("enabledToast"));
        else if (r === "dismissed") toast.message(t("permissionDismissed"));
        else if (r === "failed") toast.error(t("enableFailed"));
        // "blocked": la tarjeta ya muestra cómo desbloquear.
      }}
      onDisable={async () => {
        if (await disable()) toast.success(t("disabledToast"));
        else toast.error(t("disableFailed"));
      }}
      onTest={async () => {
        const r = await sendTest(t("testTitle"), t("testBody"));
        if (r === "sent") toast.success(t("testSent"));
        else if (r === "expired") toast.error(t("testExpired"));
        else toast.error(t("testFailed"));
      }}
    />
  );
}
