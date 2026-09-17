import { describe, expect, it } from "vitest";
import { describeDbError } from "./db-error";

// Lo que se prueba acá es que un fallo de la base nunca llegue al
// usuario como una pared lisa: o bien se traduce a una causa concreta,
// o bien arrastra el detalle técnico para que sirva al reportarlo.

describe("describeDbError", () => {
  const fallback = "No se pudo crear el vehículo";

  it("traduce la placa o el VIN repetidos", () => {
    const r = describeDbError(
      { code: "23505", message: 'duplicate key value violates unique constraint' },
      fallback,
    );
    expect(r.status).toBe(409);
    expect(r.error).toMatch(/placa o VIN/i);
  });

  it("traduce una fecha fuera de rango", () => {
    // El 22009 real de producción: un año de seis cifras colado por un
    // <input type="date">.
    const r = describeDbError(
      { code: "22009", message: 'time zone displacement out of range: "+112026-07"' },
      fallback,
    );
    expect(r.status).toBe(400);
    expect(r.error).toMatch(/fecha/i);
  });

  it("traduce la falta de permisos", () => {
    const r = describeDbError(
      { code: "42501", message: "new row violates row-level security policy" },
      fallback,
    );
    expect(r.status).toBe(403);
    expect(r.error).toMatch(/permiso/i);
  });

  it("traduce un contacto que ya no existe", () => {
    const r = describeDbError(
      { code: "23503", message: "violates foreign key constraint" },
      fallback,
    );
    expect(r.status).toBe(400);
    expect(r.error).toMatch(/contacto/i);
  });

  it("arrastra el detalle técnico cuando el código es desconocido", () => {
    const r = describeDbError(
      { code: "XX000", message: "internal error 42" },
      fallback,
    );
    expect(r.status).toBe(500);
    expect(r.error).toContain(fallback);
    expect(r.error).toContain("internal error 42");
  });

  it("se queda en el mensaje base cuando no hay nada que contar", () => {
    const r = describeDbError(null, fallback);
    expect(r).toEqual({ status: 500, error: fallback });
  });
});
