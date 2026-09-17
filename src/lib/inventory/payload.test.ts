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

  // Reordenar las fotos manda EXACTAMENTE esto, desde la ficha del
  // inventario y desde la cola de publicaciones. Si el patch arrastrara
  // otras columnas, acomodar fotos editaría el vehículo por la espalda.
  it("acepta un patch que solo reordena las fotos", () => {
    const images = ["b.jpg", "a.jpg", "c.jpg"];
    const v = ok(buildVehiclePayload({ images }, { partial: true }));

    expect(v.images).toEqual(images);
    expect(Object.keys(v)).toEqual(["images"]);
  });

  it("conserva el orden recibido en vez de normalizarlo", () => {
    // El orden ES el dato: es la portada de la vitrina y el encuadre
    // del carrusel. Ordenarlo acá arruinaría justo lo que se guardó.
    const v = ok(
      buildVehiclePayload({ images: ["z.jpg", "a.jpg"] }, { partial: true }),
    );

    expect(v.images).toEqual(["z.jpg", "a.jpg"]);
  });
});

describe("buildVehiclePayload — propietario", () => {
  const OWNER = "c0ffee00-0000-4000-8000-000000000002";

  it("acepta un propietario", () => {
    const v = ok(buildVehiclePayload({ owner_contact_id: OWNER }, { partial: true }));
    expect(v.owner_contact_id).toBe(OWNER);
  });

  it("vacío o null lo quita", () => {
    expect(ok(buildVehiclePayload({ owner_contact_id: "" }, { partial: true })).owner_contact_id).toBeNull();
    expect(ok(buildVehiclePayload({ owner_contact_id: null }, { partial: true })).owner_contact_id).toBeNull();
  });

  it("un patch sin el campo no lo toca", () => {
    const v = ok(buildVehiclePayload({ mileage: 1000 }, { partial: true }));
    expect("owner_contact_id" in v).toBe(false);
  });

  it("no se limpia al cambiar de estado, a diferencia del comprador", () => {
    const v = ok(
      buildVehiclePayload({ status: "hidden", owner_contact_id: OWNER }, { partial: true }),
    );
    expect(v.owner_contact_id).toBe(OWNER);
    expect(v.sold_to_contact_id).toBeNull();
  });

  it("rechaza un valor que no es texto", () => {
    expect(buildVehiclePayload({ owner_contact_id: 42 }, { partial: true })).toEqual({
      error: "Revisa «Propietario»: el contacto elegido no es válido",
      field: "owner_contact_id",
    });
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

// Regresión de producción (2026-09-17): al teclear el año de más en un
// <input type="date"> llegaba "112026-07-15". `Date.parse` lo acepta,
// `toISOString()` lo devuelve en formato extendido ("+112026-07-15T…")
// y el recorte a diez caracteres lo dejaba en "+112026-07". Postgres
// leía ese "+112026" como desplazamiento de zona horaria y abortaba el
// INSERT con 22009, que la ruta mostraba como "No se pudo crear el
// vehículo" — sin decir cuál era el campo culpable.
describe("buildVehiclePayload — fechas con año fuera de rango", () => {
  const outOfRange = "112026-07-15";

  it("rechaza el vencimiento del SOAT con año de más", () => {
    expect(
      buildVehiclePayload(
        { ...base, soat_expires_at: outOfRange },
        { partial: false },
      ),
    ).toHaveProperty("error");
  });

  it("rechaza el vencimiento de la tecnomecánica con año de más", () => {
    expect(
      buildVehiclePayload(
        { ...base, tecnomecanica_expires_at: outOfRange },
        { partial: false },
      ),
    ).toHaveProperty("error");
  });

  it("rechaza la fecha de venta con año de más", () => {
    expect(
      buildVehiclePayload(
        {
          ...base,
          status: "sold",
          sold_price: 10,
          sold_at: outOfRange,
        },
        { partial: false },
      ),
    ).toHaveProperty("error");
  });

  it("nunca deja salir una fecha en formato extendido", () => {
    // Red de seguridad del recorte: ninguna fecha aceptada puede llevar
    // el signo del formato ISO extendido.
    const v = ok(
      buildVehiclePayload(
        { ...base, soat_expires_at: "2027-01-31" },
        { partial: false },
      ),
    );
    expect(v.soat_expires_at).toBe("2027-01-31");
  });

  it("rechaza la fecha de compra con año de más", () => {
    expect(
      buildAcquisitionPayload({
        purchase_cost: 100,
        purchase_date: outOfRange,
      }),
    ).toHaveProperty("error");
  });
});

// El mensaje de error es lo único que el usuario tiene para saber qué
// corregir: si nombra la columna de la base ("fuel_type inválido") en vez
// del campo que ve en pantalla ("Combustible"), no le sirve de nada.
describe("buildVehiclePayload — el error nombra el campo de la pantalla", () => {
  function errorOf(body: Record<string, unknown>): string {
    const r = buildVehiclePayload({ ...base, ...body }, { partial: false });
    if (!("error" in r)) throw new Error("esperaba error, dio éxito");
    return r.error;
  }

  const cases: [string, Record<string, unknown>, string][] = [
    ["marca vacía", { brand: "  " }, "Marca"],
    ["línea vacía", { model: "" }, "Línea"],
    ["año imposible", { year: 3200 }, "Año"],
    ["precio negativo", { price: -1 }, "Precio"],
    ["kilometraje negativo", { mileage: -5 }, "Kilometraje"],
    ["combustible desconocido", { fuel_type: "plutonio" }, "Combustible"],
    ["transmisión desconocida", { transmission: "x" }, "Transmisión"],
    ["carrocería desconocida", { body_type: "x" }, "Carrocería"],
    ["condición desconocida", { condition: "x" }, "Condición"],
    ["estado desconocido", { status: "x" }, "Estado"],
    [
      "precio con garantía negativo",
      { warranty_price: -3 },
      "Precio con garantía",
    ],
    [
      "precio de venta negativo",
      { status: "sold", sold_price: -2 },
      "Precio de venta",
    ],
  ];

  for (const [name, body, label] of cases) {
    it(`nombra «${label}» cuando hay ${name}`, () => {
      const msg = errorOf(body);
      expect(msg).toContain(label);
      // Y nunca el nombre técnico de la columna.
      expect(msg).not.toMatch(/[a-z]+_[a-z]+/);
    });
  }

  it("el año obligatorio también se nombra en español", () => {
    const r = buildVehiclePayload({ brand: "Toyota", model: "Corolla" }, {
      partial: false,
    });
    if (!("error" in r)) throw new Error("esperaba error");
    expect(r.error).toContain("Año");
  });
});

// Además del texto, el error dice QUÉ campo falló. Es lo que le permite
// al formulario marcar el input en rojo y llevar al usuario hasta él, en
// vez de dejarlo buscando a ojo cuál de los treinta campos corregir.
describe("buildVehiclePayload — el error señala el campo", () => {
  function fieldOf(
    body: Record<string, unknown>,
    opts = { partial: false },
  ): string | undefined {
    const r = buildVehiclePayload({ ...base, ...body }, opts);
    if (!("error" in r)) throw new Error("esperaba error, dio éxito");
    return r.field;
  }

  it("señala la marca", () => {
    expect(fieldOf({ brand: "" })).toBe("brand");
  });

  it("señala el año", () => {
    expect(fieldOf({ year: 3200 })).toBe("year");
  });

  it("señala el campo de fecha exacto, no «alguna fecha»", () => {
    expect(fieldOf({ soat_expires_at: "112026-07-15" })).toBe("soat_expires_at");
    expect(fieldOf({ tecnomecanica_expires_at: "112026-07-15" })).toBe(
      "tecnomecanica_expires_at",
    );
  });

  it("señala el select que trae un valor desconocido", () => {
    expect(fieldOf({ fuel_type: "plutonio" })).toBe("fuel_type");
  });

  it("señala el precio de venta cuando se marca vendido sin cerrarlo", () => {
    expect(fieldOf({ status: "sold" })).toBe("sold_price");
  });

  it("señala el costo de compra", () => {
    const r = buildAcquisitionPayload({ purchase_cost: -5 });
    if (!("error" in r)) throw new Error("esperaba error");
    expect(r.field).toBe("purchase_cost");
  });

  it("señala la fecha de compra", () => {
    const r = buildAcquisitionPayload({
      purchase_cost: 100,
      purchase_date: "112026-07-15",
    });
    if (!("error" in r)) throw new Error("esperaba error");
    expect(r.field).toBe("purchase_date");
  });
});
