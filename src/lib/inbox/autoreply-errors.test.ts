import { describe, it, expect } from "vitest";
import { AUTOREPLY_ERROR_CODES, autoreplyErrorKey } from "./autoreply-errors";

describe("autoreplyErrorKey", () => {
  it("el hilo ajeno tiene su mensaje", () => {
    expect(autoreplyErrorKey(AUTOREPLY_ERROR_CODES.notAssignee)).toBe("resumeNotYours");
  });

  it("reactivar con la IA ya activa tiene su mensaje", () => {
    expect(autoreplyErrorKey(AUTOREPLY_ERROR_CODES.aiAlreadyActive)).toBe(
      "resumeAlreadyActive",
    );
  });

  // Sin código (500, 404, 429, el 403 de requireRole) o con uno
  // desconocido: no se le inventa un motivo.
  it("cae al genérico sin código o con uno desconocido", () => {
    expect(autoreplyErrorKey(undefined)).toBe("updateError");
    expect(autoreplyErrorKey(null)).toBe("updateError");
    expect(autoreplyErrorKey("otro")).toBe("updateError");
  });
});
