import { NextResponse } from 'next/server'

import { getVapidConfig } from '@/lib/push/config'

/**
 * GET /api/push/config   (público)
 *
 * La clave pública VAPID, que el navegador necesita para suscribirse.
 * Es pública por diseño —viaja a todo navegador que se suscribe—, así
 * que no pide sesión. Se sirve en ejecución, y no como `NEXT_PUBLIC_*`,
 * para que rotarla no obligue a reconstruir la imagen.
 */
export async function GET() {
  const vapid = getVapidConfig()
  return NextResponse.json({
    enabled: vapid !== null,
    publicKey: vapid?.publicKey ?? null,
  })
}
