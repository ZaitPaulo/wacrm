import { describe, it, expect } from "vitest";

import { dealErrorKey } from "./deal-errors";

// El índice único parcial de la migración 532
// —`deals (conversation_id) WHERE status = 'open'`— cambia el
// comportamiento de la creación manual desde la bandeja: lo que antes
// pasaba, ahora vuelve con un 23505. El asesor tiene que leer por qué.
describe("dealErrorKey", () => {
  it("traduce la violación de unicidad a 'ya hay un negocio abierto'", () => {
    const error = { code: "23505", message: 'duplicate key value violates unique constraint "idx_deals_one_open_per_conversation"' };

    expect(dealErrorKey(error, "toastFailedCreate")).toBe("toastDuplicateOpenDeal");
    expect(dealErrorKey(error, "toastFailedSave")).toBe("toastDuplicateOpenDeal");
  });

  it("deja el mensaje genérico de alta para cualquier otro error", () => {
    expect(dealErrorKey({ code: "23503", message: "fk" }, "toastFailedCreate")).toBe(
      "toastFailedCreate",
    );
  });

  it("deja el mensaje genérico de edición para cualquier otro error", () => {
    expect(dealErrorKey({ code: "42501", message: "rls" }, "toastFailedSave")).toBe(
      "toastFailedSave",
    );
  });

  it("no se cae con un error sin forma conocida", () => {
    expect(dealErrorKey(null, "toastFailedCreate")).toBe("toastFailedCreate");
    expect(dealErrorKey(undefined, "toastFailedCreate")).toBe("toastFailedCreate");
    expect(dealErrorKey("boom", "toastFailedCreate")).toBe("toastFailedCreate");
    expect(dealErrorKey({}, "toastFailedSave")).toBe("toastFailedSave");
  });
});
