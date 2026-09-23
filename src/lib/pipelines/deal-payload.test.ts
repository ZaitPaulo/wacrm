import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

import { newDealFields } from "./deal-payload";

const FORM = readFileSync(
  join(process.cwd(), "src", "components", "pipelines", "deal-form.tsx"),
  "utf8",
);

// Tarea 4bis.1 — el alta vincula la conversación
describe("newDealFields", () => {
  it("escribe la conversación cuando el contacto tiene una", () => {
    const fields = newDealFields({
      userId: "u-1",
      accountId: "acc-1",
      conversation: { id: "conv-9" },
    });

    expect(fields).toEqual({
      user_id: "u-1",
      account_id: "acc-1",
      status: "open",
      conversation_id: "conv-9",
    });
  });

  // Tarea 4bis.2 — sin conversación va null, no se inventa un vínculo
  it("deja el vínculo en null cuando el contacto no tiene conversación", () => {
    expect(
      newDealFields({ userId: "u-1", accountId: "acc-1", conversation: null }).conversation_id,
    ).toBeNull();
  });

  it("trata la conversación ausente igual que la nula", () => {
    // El estado del formulario nace en null, pero un `undefined` que
    // llegara por otro camino no debe convertirse en la cadena "undefined".
    expect(
      newDealFields({ userId: "u-1", accountId: "acc-1", conversation: undefined })
        .conversation_id,
    ).toBeNull();
  });

  it("siempre nace abierto, que es lo que el índice único de la 532 vigila", () => {
    expect(
      newDealFields({ userId: "u-1", accountId: "acc-1", conversation: { id: "c" } }).status,
    ).toBe("open");
  });
});

// Tarea 4bis.3 — la edición no toca el campo
//
// Esto se verifica sobre la fuente y no sobre el render porque lo que hay
// que impedir es un refactor: que alguien mueva `conversation_id` al
// `payload` compartido y, sin querer, haga que editar un negocio repise
// su vínculo. El tipo solo no alcanza —`payload` es un objeto literal—,
// así que la garantía se fija acá.
describe("el vínculo con la conversación es exclusivo del alta", () => {
  it("el payload compartido entre alta y edición no lleva conversation_id", () => {
    const payload = /const payload = \{([\s\S]*?)\n {4}\};/.exec(FORM)?.[1];

    expect(payload, "no se encontró el payload compartido en deal-form.tsx").toBeTruthy();
    expect(payload).not.toContain("conversation_id");
    expect(payload).not.toContain("linkedConversation");
  });

  it("la edición manda el payload tal cual, sin agregarle campos", () => {
    const update = /\.update\(([\s\S]*?)\)\s*\n\s*\.eq\("id", deal\.id\)/.exec(FORM)?.[1];

    expect(update, "no se encontró el update del negocio").toBeTruthy();
    expect(update?.trim()).toBe("payload");
  });

  it("el alta agrega el vínculo a través de newDealFields", () => {
    expect(FORM).toContain('from("deals").insert({');
    expect(FORM).toMatch(/newDealFields\(\{[\s\S]*?conversation: linkedConversation,/);
  });
});
