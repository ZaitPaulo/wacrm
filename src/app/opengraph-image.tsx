import { ImageResponse } from 'next/og'
import { getShowcase } from '@/lib/showcase/data'

export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'
export const alt = 'Vehículos disponibles'

// OG image dinámica de la portada de la vitrina (texto, sin imágenes
// remotas → siempre renderiza).
export default async function OgImage() {
  const data = await getShowcase()
  const name = data
    ? data.account.public_name?.trim() || data.account.name
    : 'Vitrina'
  const count = data?.vehicles.length ?? 0

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: 80,
          background: 'linear-gradient(135deg, #0f172a, #334155)',
          color: 'white',
          fontFamily: 'sans-serif',
        }}
      >
        <div
          style={{
            fontSize: 30,
            opacity: 0.7,
            textTransform: 'uppercase',
            letterSpacing: 6,
          }}
        >
          {name}
        </div>
        <div style={{ fontSize: 74, fontWeight: 800, marginTop: 24, lineHeight: 1.05 }}>
          Encuentra tu próximo vehículo
        </div>
        <div style={{ fontSize: 34, opacity: 0.85, marginTop: 28 }}>
          {count} vehículo{count === 1 ? '' : 's'} disponible{count === 1 ? '' : 's'}
        </div>
      </div>
    ),
    { ...size },
  )
}
