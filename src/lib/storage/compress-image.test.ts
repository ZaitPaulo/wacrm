import { describe, expect, it } from "vitest";
import {
  IMAGE_MAX_DIMENSION,
  targetDimensions,
  toWebpName,
} from "./compress-image";

// `compressImage` necesita canvas y no se prueba acá; lo que sí tiene
// lógica propia —y es donde un error pasa desapercibido— son estos dos.

describe("targetDimensions", () => {
  it("leaves an image that already fits untouched", () => {
    expect(targetDimensions(800, 600)).toEqual({ width: 800, height: 600 });
  });

  it("never upscales a small image", () => {
    expect(targetDimensions(320, 240)).toEqual({ width: 320, height: 240 });
  });

  it("scales by the longest side, keeping the aspect ratio", () => {
    // 4000x3000 (4:3 apaisada) -> el lado mayor queda en el tope.
    expect(targetDimensions(4000, 3000)).toEqual({
      width: IMAGE_MAX_DIMENSION,
      height: 1440,
    });
  });

  it("handles portrait photos, where the longest side is the height", () => {
    expect(targetDimensions(3000, 4000)).toEqual({
      width: 1440,
      height: IMAGE_MAX_DIMENSION,
    });
  });

  it("keeps an exact square exactly square", () => {
    expect(targetDimensions(4000, 4000)).toEqual({
      width: IMAGE_MAX_DIMENSION,
      height: IMAGE_MAX_DIMENSION,
    });
  });

  it("never returns a zero side for an extreme panorama", () => {
    // 10000x3 escalado daría 0.57 px de alto; un canvas de altura 0
    // lanza al dibujar.
    const { height } = targetDimensions(10000, 3);
    expect(height).toBeGreaterThanOrEqual(1);
  });

  it("honours a custom maximum", () => {
    expect(targetDimensions(2000, 1000, 500)).toEqual({ width: 500, height: 250 });
  });
});

describe("toWebpName", () => {
  it("replaces the extension", () => {
    expect(toWebpName("foto.jpg")).toBe("foto.webp");
    expect(toWebpName("FOTO.JPEG")).toBe("FOTO.webp");
  });

  it("only replaces the trailing extension", () => {
    expect(toWebpName("mazda.3.2020.png")).toBe("mazda.3.2020.webp");
  });

  it("adds the extension when the name has none", () => {
    expect(toWebpName("captura")).toBe("captura.webp");
  });

  it("falls back to a name when there is nothing but an extension", () => {
    expect(toWebpName(".jpg")).toBe("imagen.webp");
  });
});
