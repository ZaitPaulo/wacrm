import { describe, expect, it } from "vitest";
import { buildVehiclePayload, buildAcquisitionPayload } from "./payload";

// El invariante que se prueba aquí es el mismo que impone el CHECK
// `inventory_vehicles_sold_coherence` de la migración 508: sólo un
// vehículo en 'sold' puede llevar datos de cierre. Validarlo también en
// la aplicación permite devolver un 400 con mensaje en vez de dejar que
// la base rechace el INSERT con un error opaco.

const base = { brand: "Toyota", model: "Corolla", year: 2021 };

function ok(result: ReturnType<typeof buildVehiclePayload>) {
  if ("error" in result) throw new Error(`esperaba éxito, dio: ${result.error}`);
  return result.value;
}

describe("buildVehiclePayload — cierre de venta", () => {
  it("acepta una venta completa", () => {
    const v = ok(
      buildVehiclePayload(
        {
          ...base,
          status: "sold",
          sold_price: 17800,
          sold_at: "2026-08-01",
          sold_to_contact_id: "c0ffee00-0000-4000-8000-000000000001",
        },
        { partial: false },
      ),
    );

    expect(v.status).toBe("sold");
    expect(v.sold_price).toBe(17800);
    expect(v.sold_to_contact_id).toBe("c0ffee00-0000-4000-8000-000000000001");
  });

  it("exige el precio al marcar como vendido", () => {
    const r = buildVehiclePayload(
      { ...base, status: "sold" },
      { partial: false },
    );

    // Sin precio de cierre la venta entraría al tablero como un hueco
    // silencioso: sin margen, sin ingreso, sin ticket.
    expect(r).toHaveProperty("error");
  });

  it("usa la fecha de hoy cuando la venta no trae fecha", () => {
    const v = ok(
      buildVehiclePayload(
        { ...base, status: "sold", sold_price: 17800 },
        { partial: false },
      ),
    );

    expect(v.sold_at).not.toBeNull();
    expect(Date.parse(v.sold_at!)).not.toBeNaN();
  });

  it("permite vender por debajo del precio de lista", () => {
    const v = ok(
      buildVehiclePayload(
        { ...base, price: 18500, status: "sold", sold_price: 16000 },
        { partial: false },
      ),
    );

    // Un descuento es normal y no debe bloquearse; ambos montos se
    // conservan por separado.
    expect(v.price).toBe(18500);
    expect(v.sold_price).toBe(16000);
  });

  it("rechaza un precio de venta negativo", () => {
    expect(
      buildVehiclePayload(
        { ...base, status: "sold", sold_price: -1 },
        { partial: false },
      ),
    ).toHaveProperty("error");
  });

  it("limpia el cierre al revertir la venta", () => {
    // El cliente sólo manda el estado nuevo; los campos de cierre deben
    // limpiarse igual, o el vehículo volvería a stock arrastrando un
    // precio de venta viejo.
    const v = ok(buildVehiclePayload({ status: "available" }, { partial: true }));

    expect(v.sold_price).toBeNull();
    expect(v.sold_at).toBeNull();
    expect(v.sold_to_contact_id).toBeNull();
  });

  it("no toca el cierre cuando el patch no trae estado", () => {
    // Editar el kilometraje de un auto ya vendido no debe borrarle la venta.
    const v = ok(buildVehiclePayload({ mileage: 42000 }, { partial: true }));

    expect(v.mileage).toBe(42000);
    expect(v.sold_price).toBeUndefined();
    expect(v.sold_at).toBeUndefined();
  });
});

describe("buildAcquisitionPayload", () => {
  it("devuelve null cuando no hay datos de compra", () => {
    const r = buildAcquisitionPayload({ brand: "Toyota" });
    expect(r).toEqual({ value: null, clear: false });
  });

  it("normaliza la fecha a sólo fecha", () => {
    const r = buildAcquisitionPayload({
      purchase_cost: 15000,
      purchase_date: "2026-03-15T10:30:00Z",
    });

    expect(r).toEqual({
      value: { purchase_cost: 15000, purchase_date: "2026-03-15" },
      clear: false,
    });
  });

  it("acepta costo sin fecha", () => {
    const r = buildAcquisitionPayload({ purchase_cost: 15000 });
    expect(r).toEqual({
      value: { purchase_cost: 15000, purchase_date: null },
      clear: false,
    });
  });

  it("pide borrar el registro cuando se vacía el costo", () => {
    // Una fecha de compra sin monto no sirve para nada: se borra entero.
    expect(buildAcquisitionPayload({ purchase_cost: null })).toEqual({
      value: null,
      clear: true,
    });
  });

  it("rechaza un costo negativo", () => {
    expect(buildAcquisitionPayload({ purchase_cost: -5 })).toHaveProperty("error");
  });

  it("rechaza una fecha inválida", () => {
    expect(
      buildAcquisitionPayload({ purchase_cost: 100, purchase_date: "ayer" }),
    ).toHaveProperty("error");
  });
});
