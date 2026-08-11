import { describe, expect, it } from "vitest";
import {
  bucketForDays,
  buildInventoryAging,
  buildInventorySnapshot,
  buildMarginSummary,
  buildSalesPerformance,
  buildVehicleInterest,
  soldInRange,
  type AcquisitionRow,
  type VehicleRow,
} from "./vehicle-metrics";

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-08-11T12:00:00Z");

/** Vehículo con valores por defecto razonables; se sobreescribe lo que importe. */
function vehicle(over: Partial<VehicleRow> & { id: string }): VehicleRow {
  return {
    brand: "Toyota",
    model: "Corolla",
    year: 2021,
    body_type: "sedan",
    price: 18500,
    status: "available",
    created_at: NOW.toISOString(),
    sold_price: null,
    sold_at: null,
    ...over,
  };
}

/** Fecha a N días antes de NOW, en formato DATE. */
function daysBefore(n: number): string {
  return new Date(NOW.getTime() - n * DAY).toISOString().slice(0, 10);
}

describe("bucketForDays — bordes de los tramos", () => {
  it("clasifica los límites exactos", () => {
    // Los bordes son donde un off-by-one pasa desapercibido y mueve
    // vehículos entre "recién llegado" y "alerta".
    expect(bucketForDays(0)).toBe("0-30");
    expect(bucketForDays(30)).toBe("0-30");
    expect(bucketForDays(31)).toBe("31-60");
    expect(bucketForDays(60)).toBe("31-60");
    expect(bucketForDays(61)).toBe("61-90");
    expect(bucketForDays(90)).toBe("61-90");
    expect(bucketForDays(91)).toBe("90+");
    expect(bucketForDays(365)).toBe("90+");
  });
});

describe("buildInventorySnapshot", () => {
  it("suma sólo el stock disponible como capital inmovilizado", () => {
    const snap = buildInventorySnapshot([
      vehicle({ id: "a", price: 10000, status: "available" }),
      vehicle({ id: "b", price: 20000, status: "available" }),
      // Un vendido y un oculto no son capital inmovilizado.
      vehicle({ id: "c", price: 99000, status: "sold" }),
      vehicle({ id: "d", price: 77000, status: "hidden" }),
    ]);

    expect(snap.availableValue).toBe(30000);
    expect(snap.availableCount).toBe(2);
    expect(snap.total).toBe(4);
    expect(snap.byStatus).toEqual({ available: 2, sold: 1, hidden: 1 });
  });

  it("ignora marcas vacías en el mix", () => {
    const snap = buildInventorySnapshot([
      vehicle({ id: "a", brand: "Kia" }),
      vehicle({ id: "b", brand: "  " }),
      vehicle({ id: "c", brand: null }),
    ]);

    expect(snap.byBrand).toEqual([{ name: "Kia", count: 1 }]);
  });
});

describe("buildInventoryAging", () => {
  it("prefiere la fecha de compra sobre la de alta", () => {
    const rows = [
      vehicle({ id: "a", created_at: NOW.toISOString() }), // alta hoy…
    ];
    // …pero comprado hace 120 días: el capital lleva parado 120 días.
    const acq: AcquisitionRow[] = [
      { vehicle_id: "a", purchase_cost: 1, purchase_date: daysBefore(120) },
    ];

    const aging = buildInventoryAging(rows, acq, NOW);
    expect(aging.buckets.find((b) => b.key === "90+")!.count).toBe(1);
    expect(aging.buckets.find((b) => b.key === "0-30")!.count).toBe(0);
  });

  it("cae a la fecha de alta cuando no hay compra registrada", () => {
    const rows = [
      vehicle({ id: "a", created_at: new Date(NOW.getTime() - 45 * DAY).toISOString() }),
    ];

    const aging = buildInventoryAging(rows, [], NOW);
    expect(aging.buckets.find((b) => b.key === "31-60")!.count).toBe(1);
    // Un vehículo sin costo NO se esconde del aging: sigue ocupando patio.
    expect(aging.total).toBe(1);
  });

  it("excluye los vendidos del stock", () => {
    const rows = [
      vehicle({ id: "a", status: "sold", sold_at: NOW.toISOString(), sold_price: 1 }),
      vehicle({ id: "b", status: "available" }),
    ];

    const aging = buildInventoryAging(rows, [], NOW);
    expect(aging.total).toBe(1);
  });

  it("acumula el valor inmovilizado por tramo", () => {
    const rows = [
      vehicle({ id: "a", price: 10000, created_at: new Date(NOW.getTime() - 100 * DAY).toISOString() }),
      vehicle({ id: "b", price: 15000, created_at: new Date(NOW.getTime() - 200 * DAY).toISOString() }),
    ];

    const aging = buildInventoryAging(rows, [], NOW);
    expect(aging.buckets.find((b) => b.key === "90+")!.value).toBe(25000);
  });
});

describe("soldInRange", () => {
  it("filtra por fecha de venta e ignora los no vendidos", () => {
    const rows = [
      vehicle({ id: "in", status: "sold", sold_price: 100, sold_at: "2026-08-05T00:00:00Z" }),
      vehicle({ id: "out", status: "sold", sold_price: 100, sold_at: "2026-06-01T00:00:00Z" }),
      vehicle({ id: "avail", status: "available" }),
    ];

    const result = soldInRange(rows, new Date("2026-08-01"), new Date("2026-08-31"));
    expect(result.map((v) => v.id)).toEqual(["in"]);
  });
});

describe("buildSalesPerformance", () => {
  it("calcula ingresos y ticket promedio", () => {
    const sold = [
      vehicle({ id: "a", status: "sold", sold_price: 20000, sold_at: NOW.toISOString() }),
      vehicle({ id: "b", status: "sold", sold_price: 10000, sold_at: NOW.toISOString() }),
    ];

    const perf = buildSalesPerformance(sold, []);
    expect(perf.unitsSold).toBe(2);
    expect(perf.revenue).toBe(30000);
    expect(perf.avgTicket).toBe(15000);
  });

  it("no promedia sobre cero unidades", () => {
    const perf = buildSalesPerformance([], []);
    // Null y no 0: "no hubo ventas" no es "el ticket promedio fue 0".
    expect(perf.avgTicket).toBeNull();
    expect(perf.avgDaysInStock).toBeNull();
    expect(perf.daysSampleSize).toBe(0);
  });

  it("promedia días en stock sólo sobre las unidades con fecha de compra", () => {
    const sold = [
      vehicle({ id: "a", status: "sold", sold_price: 1, sold_at: NOW.toISOString() }),
      vehicle({ id: "b", status: "sold", sold_price: 1, sold_at: NOW.toISOString() }),
    ];
    const acq: AcquisitionRow[] = [
      { vehicle_id: "a", purchase_cost: 1, purchase_date: daysBefore(40) },
    ];

    const perf = buildSalesPerformance(sold, acq);
    expect(perf.avgDaysInStock).toBe(40);
    // La muestra dice sobre cuántas de las 2 se calculó.
    expect(perf.daysSampleSize).toBe(1);
    expect(perf.unitsSold).toBe(2);
  });
});

describe("buildMarginSummary", () => {
  const sold = [
    vehicle({ id: "a", brand: "Toyota", status: "sold", sold_price: 20000, sold_at: NOW.toISOString() }),
    vehicle({ id: "b", brand: "Kia", status: "sold", sold_price: 10000, sold_at: NOW.toISOString() }),
  ];

  it("calcula utilidad y porcentaje", () => {
    const acq: AcquisitionRow[] = [
      { vehicle_id: "a", purchase_cost: 15000, purchase_date: null },
      { vehicle_id: "b", purchase_cost: 8000, purchase_date: null },
    ];

    const m = buildMarginSummary(sold, acq);
    expect(m.profit).toBe(7000);
    expect(m.revenue).toBe(30000);
    expect(m.marginPct).toBeCloseTo(23.33, 1);
    expect(m.unitsWithCost).toBe(2);
    expect(m.unitsWithoutCost).toBe(0);
  });

  it("excluye las unidades sin costo en vez de asumir cero", () => {
    const acq: AcquisitionRow[] = [
      { vehicle_id: "a", purchase_cost: 15000, purchase_date: null },
    ];

    const m = buildMarginSummary(sold, acq);
    // Si "b" contara como costo 0, la utilidad sería 15.000 y el margen
    // 50% — un número inventado. Debe quedar fuera y reportarse aparte.
    expect(m.profit).toBe(5000);
    expect(m.revenue).toBe(20000);
    expect(m.unitsWithCost).toBe(1);
    expect(m.unitsWithoutCost).toBe(1);
  });

  it("sin permiso para leer costos devuelve margen vacío", () => {
    // Lo que recibe un 'agent': la RLS le da [] y nada se calcula.
    const m = buildMarginSummary(sold, []);
    expect(m.profit).toBe(0);
    expect(m.unitsWithCost).toBe(0);
    expect(m.unitsWithoutCost).toBe(2);
    expect(m.byBrand).toEqual([]);
  });

  it("agrupa por marca ordenando por utilidad", () => {
    const acq: AcquisitionRow[] = [
      { vehicle_id: "a", purchase_cost: 19000, purchase_date: null }, // +1000
      { vehicle_id: "b", purchase_cost: 5000, purchase_date: null }, // +5000
    ];

    const m = buildMarginSummary(sold, acq);
    expect(m.byBrand.map((b) => b.brand)).toEqual(["Kia", "Toyota"]);
    expect(m.byBrand[0].marginPct).toBeCloseTo(50, 1);
  });

  it("admite ventas a pérdida", () => {
    const acq: AcquisitionRow[] = [
      { vehicle_id: "a", purchase_cost: 25000, purchase_date: null },
    ];

    const m = buildMarginSummary([sold[0]], acq);
    expect(m.profit).toBe(-5000);
    expect(m.marginPct).toBeCloseTo(-25, 1);
  });
});

describe("buildVehicleInterest", () => {
  const vehicles = [
    vehicle({ id: "a", brand: "Toyota", model: "Corolla", year: 2021, status: "sold" }),
    vehicle({ id: "b", brand: "Kia", model: "Sportage", year: 2022 }),
  ];

  it("ordena por número de consultas", () => {
    const interest = buildVehicleInterest(
      [{ vehicle_id: "b" }, { vehicle_id: "b" }, { vehicle_id: "a" }],
      vehicles,
    );

    expect(interest.rows[0].vehicleId).toBe("b");
    expect(interest.rows[0].inquiries).toBe(2);
    expect(interest.rows[0].label).toBe("Kia Sportage 2022");
    expect(interest.totalInquiries).toBe(3);
  });

  it("calcula la conversión sobre consultas de vehículos vendidos", () => {
    const interest = buildVehicleInterest(
      [{ vehicle_id: "a" }, { vehicle_id: "b" }],
      vehicles,
    );

    // "a" está vendido: 1 de 2 consultas terminó en venta.
    expect(interest.conversionPct).toBe(50);
  });

  it("sin consultas no inventa una conversión", () => {
    const interest = buildVehicleInterest([], vehicles);
    expect(interest.conversionPct).toBeNull();
    expect(interest.rows).toEqual([]);
  });
});
