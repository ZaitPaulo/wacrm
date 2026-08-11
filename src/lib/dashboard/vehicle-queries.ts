// ============================================================
// Consultas del tablero de compraventa.
//
// Mismo patrón que ./queries.ts: se traen filas crudas y se agrega en
// JavaScript, sin rpc() ni vistas. La RLS acota cada consulta a la
// cuenta del usuario firmado.
//
// REGLA CRÍTICA: `db` es SIEMPRE el cliente de sesión, nunca
// service-role. Es lo único que impide que un 'agent' vea el costo de
// compra: con la sesión del usuario, la RLS de `vehicle_acquisitions`
// (migración 508) le devuelve cero filas. Con service-role la
// devolvería entera y el gating de la UI sería decorativo.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  InventoryAging,
  InventorySnapshot,
  MarginSummary,
  SalesPerformance,
  VehicleInterest,
} from './types'
import {
  buildInventoryAging,
  buildInventorySnapshot,
  buildMarginSummary,
  buildSalesPerformance,
  buildVehicleInterest,
  soldInRange,
  type AcquisitionRow,
  type VehicleRow,
} from './vehicle-metrics'

type DB = SupabaseClient

const VEHICLE_FIELDS =
  'id, brand, model, year, body_type, price, status, created_at, sold_price, sold_at'

async function fetchVehicles(db: DB): Promise<VehicleRow[]> {
  const { data, error } = await db.from('inventory_vehicles').select(VEHICLE_FIELDS)
  if (error) throw error
  return (data ?? []) as VehicleRow[]
}

/**
 * Costos de compra. Devuelve `[]` sin error cuando el usuario no tiene
 * permiso: la RLS filtra las filas en silencio, que es exactamente el
 * comportamiento buscado — no se distingue "sin permiso" de "sin datos".
 */
async function fetchAcquisitions(db: DB): Promise<AcquisitionRow[]> {
  const { data, error } = await db
    .from('vehicle_acquisitions')
    .select('vehicle_id, purchase_cost, purchase_date')
  if (error) throw error
  return (data ?? []) as AcquisitionRow[]
}

export async function loadInventorySnapshot(db: DB): Promise<InventorySnapshot> {
  return buildInventorySnapshot(await fetchVehicles(db))
}

export async function loadInventoryAging(db: DB): Promise<InventoryAging> {
  const [vehicles, acquisitions] = await Promise.all([
    fetchVehicles(db),
    // Sólo aporta la fecha de compra; si no hay permiso, el aging cae a
    // created_at y sigue siendo correcto.
    fetchAcquisitions(db).catch(() => [] as AcquisitionRow[]),
  ])
  return buildInventoryAging(vehicles, acquisitions)
}

export async function loadSalesPerformance(
  db: DB,
  from: Date,
  to: Date,
): Promise<SalesPerformance> {
  const [vehicles, acquisitions] = await Promise.all([
    fetchVehicles(db),
    fetchAcquisitions(db).catch(() => [] as AcquisitionRow[]),
  ])
  return buildSalesPerformance(soldInRange(vehicles, from, to), acquisitions)
}

export async function loadMargins(
  db: DB,
  from: Date,
  to: Date,
): Promise<MarginSummary> {
  const [vehicles, acquisitions] = await Promise.all([
    fetchVehicles(db),
    fetchAcquisitions(db),
  ])
  return buildMarginSummary(soldInRange(vehicles, from, to), acquisitions)
}

export async function loadVehicleInterest(
  db: DB,
  from: Date,
  to: Date,
): Promise<VehicleInterest> {
  const [vehicles, inquiries] = await Promise.all([
    fetchVehicles(db),
    db
      .from('vehicle_inquiries')
      .select('vehicle_id')
      .gte('created_at', from.toISOString())
      .lte('created_at', to.toISOString())
      .then(({ data, error }) => {
        if (error) throw error
        return (data ?? []) as { vehicle_id: string }[]
      }),
  ])
  return buildVehicleInterest(inquiries, vehicles)
}
