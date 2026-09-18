import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  loadMediaBlob: vi.fn(),
}));
vi.mock("./blob-cache", () => ({ loadMediaBlob: h.loadMediaBlob }));

import { shareMediaMessage } from "./share";
import type { Message } from "@/types";

const MESSAGE = {
  id: "m1",
  conversation_id: "c1",
  sender_type: "customer",
  content_type: "document",
  content_text: "cedula.pdf",
  media_url: "/api/whatsapp/media/123",
  status: "delivered",
  created_at: "2026-09-18T10:00:00Z",
} as Message;

function nav(overrides: Partial<Navigator> = {}) {
  return {
    canShare: vi.fn(() => true),
    share: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as Navigator;
}

beforeEach(() => {
  h.loadMediaBlob.mockReset();
  h.loadMediaBlob.mockResolvedValue(new Blob(["%PDF"], { type: "application/pdf" }));
});

describe("shareMediaMessage", () => {
  it("abre el menú de compartir con el archivo y su nombre", async () => {
    const n = nav();
    expect(await shareMediaMessage(MESSAGE, n)).toBe("shared");
    const { files } = (n.share as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(files[0]).toBeInstanceOf(File);
    expect(files[0].name).toBe("cedula.pdf");
    expect(files[0].type).toBe("application/pdf");
  });

  it("si el asesor cierra el menú no es un error", async () => {
    const n = nav({
      share: vi.fn(async () => {
        throw new DOMException("cancelado", "AbortError");
      }),
    });
    expect(await shareMediaMessage(MESSAGE, n)).toBe("cancelled");
  });

  // navigator.share exige un clic reciente; si bajar el archivo tardó,
  // el navegador lo niega. El archivo ya quedó en caché: el segundo
  // toque es inmediato.
  it("pide repetir el toque cuando el navegador perdió el permiso del clic", async () => {
    const n = nav({
      share: vi.fn(async () => {
        throw new DOMException("sin gesto", "NotAllowedError");
      }),
    });
    expect(await shareMediaMessage(MESSAGE, n)).toBe("retry");
  });

  it("no comparte cuando el navegador no admite ese archivo", async () => {
    const n = nav({ canShare: vi.fn(() => false) });
    expect(await shareMediaMessage(MESSAGE, n)).toBe("unsupported");
    expect(n.share).not.toHaveBeenCalled();
  });

  it("no comparte en un navegador sin Web Share", async () => {
    expect(await shareMediaMessage(MESSAGE, {} as Navigator)).toBe("unsupported");
    expect(h.loadMediaBlob).not.toHaveBeenCalled();
  });

  it("propaga el error cuando no se pudo bajar el archivo", async () => {
    h.loadMediaBlob.mockRejectedValue(new Error("401"));
    await expect(shareMediaMessage(MESSAGE, nav())).rejects.toThrow("401");
  });
});
