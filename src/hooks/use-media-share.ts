"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import type { useTranslations } from "next-intl";
import type { Message } from "@/types";
import { shareMediaMessage } from "@/lib/media/share";
import { downloadMediaMessage } from "@/lib/media/download";

/**
 * "Reenviar a WhatsApp" de un adjunto del chat: abre el menú de compartir
 * del dispositivo y, donde no se puede compartir el archivo, lo descarga
 * para que el asesor lo adjunte a mano.
 *
 * `t` es el traductor del componente que lo usa; debe tener las claves
 * `shareRetry`, `shareFallback` y `shareFailed`.
 */
export function useMediaShare(
  message: Message | null,
  t: ReturnType<typeof useTranslations>,
) {
  const [sharing, setSharing] = useState(false);

  const share = useCallback(async () => {
    if (!message || sharing) return;
    setSharing(true);
    try {
      const outcome = await shareMediaMessage(message);
      if (outcome === "retry") {
        toast.info(t("shareRetry"));
      } else if (outcome === "unsupported") {
        await downloadMediaMessage(message);
        toast.info(t("shareFallback"));
      }
    } catch {
      toast.error(t("shareFailed"));
    } finally {
      setSharing(false);
    }
  }, [message, sharing, t]);

  return { sharing, share };
}
