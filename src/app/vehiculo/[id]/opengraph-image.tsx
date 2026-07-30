import { ImageResponse } from 'next/og'
import { getShowcaseVehicle } from '@/lib/showcase/data'
import { formatPrice } from '@/lib/showcase/format'

export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'
export const alt = 'Vehículo en venta'

type Params = { params: Promise<{ id: string }> }

// OG image dinámica por vehículo: foto principal + marca/modelo/año +
// precio, para que los enlaces compartidos (WhatsApp, redes) muestren el
// auto. Si no hay foto, renderiza una tarjeta con solo texto.
export default async function OgImage({ params }: Params) {
  const { id } = await params
  const data = await getShowcaseVehicle(id)

  if (!data) {
    return new ImageResponse(
      (
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#0f172a',
            color: 'white',
            fontSize: 48,
            fontFamily: 'sans-serif',
          }}
        >
          Vehículo
        </div>
      ),
      { ...size },
    )
  }

  const { account, vehicle: v } = data
  const name = account.public_name?.trim() || account.name
  const photo = v.images?.[0]
  // Satori (next/og) exige `display: flex` en cualquier div con más de un
  // hijo. Interpolar varias expresiones en una línea genera un nodo de
  // texto por cada una, así que se arman aquí como cadena única.
  const title = `${v.brand} ${v.model} ${v.year}`
  const price = `$${formatPrice(v.price)}`

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          background: '#0f172a',
          color: 'white',
          fontFamily: 'sans-serif',
        }}
      >
        {photo ? (
          // next/og fetch la imagen remota en el servidor.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photo} width={620} height={630} style={{ objectFit: 'cover' }} alt="" />
        ) : null}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            flex: 1,
            padding: 60,
          }}
        >
          <div style={{ fontSize: 28, opacity: 0.7 }}>{name}</div>
          <div
            style={{ fontSize: 58, fontWeight: 800, marginTop: 16, lineHeight: 1.1 }}
          >
            {title}
          </div>
          <div
            style={{ fontSize: 56, fontWeight: 800, marginTop: 24, color: '#4ade80' }}
          >
            {price}
          </div>
        </div>
      </div>
    ),
    { ...size },
  )
}
