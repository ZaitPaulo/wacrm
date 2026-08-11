import { describe, expect, it } from "vitest";
import { formatRefTag, parseRefTag } from "./public-ref";

// La cadena que se prueba aquí es vitrina → WhatsApp → webhook. Lo que
// viaja en el medio es un mensaje que el cliente puede editar libremente,
// así que el parser tiene que ser tolerante con el texto de alrededor y
// estricto con el código en sí: una atribución equivocada es peor que
// ninguna.

const REF = "X7K2M9";

describe("formatRefTag", () => {
  it("produce la etiqueta esperada", () => {
    expect(formatRefTag(REF)).toBe("[Ref: X7K2M9]");
  });

  it("normaliza a mayúsculas", () => {
    expect(formatRefTag("x7k2m9")).toBe("[Ref: X7K2M9]");
  });
});

describe("parseRefTag — ida y vuelta", () => {
  it("reconoce lo que formatRefTag escribe", () => {
    const msg = `Hola, me interesa el Toyota Corolla 2021. ¿Sigue disponible? ${formatRefTag(REF)}`;
    expect(parseRefTag(msg)).toBe(REF);
  });
});

describe("parseRefTag — mensajes reales", () => {
  it("reconoce el mensaje prellenado intacto", () => {
    expect(
      parseRefTag(
        "Hola, me interesa el Toyota Corolla 2021. ¿Sigue disponible? [Ref: X7K2M9]",
      ),
    ).toBe(REF);
  });

  it("reconoce el código cuando el cliente escribió alrededor", () => {
    expect(
      parseRefTag("buenas [Ref: X7K2M9] todavia lo tienen? cuanto es lo menos"),
    ).toBe(REF);
  });

  it("tolera minúsculas y espacios extra", () => {
    expect(parseRefTag("hola [ ref :  x7k2m9 ] sigue?")).toBe(REF);
  });

  it("devuelve null si el cliente borró la etiqueta", () => {
    // Caso normal, no error: simplemente no se atribuye.
    expect(parseRefTag("Hola, me interesa el Corolla. ¿Sigue disponible?")).toBeNull();
  });

  it("devuelve null con texto vacío o ausente", () => {
    expect(parseRefTag("")).toBeNull();
    expect(parseRefTag(null)).toBeNull();
    expect(parseRefTag(undefined)).toBeNull();
  });
});

describe("parseRefTag — estrictez del código", () => {
  it("rechaza códigos de largo distinto a 6", () => {
    expect(parseRefTag("[Ref: X7K2M]")).toBeNull();
    expect(parseRefTag("[Ref: X7K2M9Q]")).toBeNull();
  });

  it("rechaza caracteres fuera del alfabeto", () => {
    // I, L, O, U y 0/1 quedaron fuera justamente para no confundirse al
    // leer o teclear; si aparecen, no es un código nuestro.
    expect(parseRefTag("[Ref: X7K2MO]")).toBeNull();
    expect(parseRefTag("[Ref: X7K2M0]")).toBeNull();
    expect(parseRefTag("[Ref: IIIIII]")).toBeNull();
    expect(parseRefTag("[Ref: X7K2ML]")).toBeNull();
  });

  it("no confunde texto suelto con un código", () => {
    expect(parseRefTag("me interesa el REF 123456 que vi")).toBeNull();
    expect(parseRefTag("X7K2M9")).toBeNull();
  });
});
