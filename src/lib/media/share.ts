import type { Message } from "@/types";
import { loadMediaBlob } from "./blob-cache";
import { mediaFilename } from "./filename";

/**
 * Cómo terminó un intento de reenviar un adjunto.
 *
 *   shared      → se abrió el menú de compartir y el asesor eligió destino.
 *   cancelled   → lo cerró sin elegir. No es un error.
 *   retry       → el navegador negó compartir porque bajar el archivo tardó
 *                 y se venció el permiso del clic. El archivo ya quedó en
 *                 caché: un segundo toque abre el menú al instante.
 *   unsupported → este navegador no comparte archivos, o no ese tipo (un
 *                 Word, por ejemplo). Quien llama recurre a la descarga.
 */
export type ShareOutcome = "shared" | "cancelled" | "retry" | "unsupported";

/**
 * Reenvía un adjunto del chat por el menú de compartir del dispositivo,
 * para que el asesor lo mande por WhatsApp a quien quiera.
 *
 * WhatsApp no deja adjuntar un archivo por enlace (`wa.me` solo lleva
 * texto), así que el camino es la Web Share API con el archivo mismo: en
 * el celular abre el menú del sistema, y en Windows el de compartir, donde
 * aparece la app de WhatsApp de escritorio si está instalada.
 *
 * Lanza si no se pudo bajar el archivo, para que quien llama avise.
 */
export async function shareMediaMessage(
  message: Message,
  nav: Navigator = navigator,
): Promise<ShareOutcome> {
  // Antes de bajar nada: sin Web Share no hay a dónde mandarlo.
  if (typeof nav.share !== "function" || typeof nav.canShare !== "function") {
    return "unsupported";
  }

  const url = message.media_url;
  if (!url) throw new Error("This message has no attachment.");

  const blob = await loadMediaBlob(url);
  const file = new File([blob], mediaFilename(message, blob.type), {
    type: blob.type || "application/octet-stream",
  });

  if (!nav.canShare({ files: [file] })) return "unsupported";

  try {
    await nav.share({ files: [file] });
    return "shared";
  } catch (error) {
    if (error instanceof DOMException) {
      if (error.name === "AbortError") return "cancelled";
      if (error.name === "NotAllowedError") return "retry";
    }
    throw error;
  }
}
