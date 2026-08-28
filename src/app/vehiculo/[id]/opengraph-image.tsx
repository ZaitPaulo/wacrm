import { ImageResponse } from 'next/og';
import sharp from 'sharp';
import { getShowcaseVehicle } from '@/lib/showcase/data';
import { formatPrice } from '@/lib/showcase/format';

export const size = { width: 1200, height: 630 };
export const contentType = 'image/jpeg';
export const alt = 'Vehículo en venta';

type Params = { params: Promise<{ id: string }> };

/** Fondo de la tarjeta, y relleno cuando la foto no cubre el encuadre. */
const CARD_BG = '#0f172a';

/**
 * Reempaqueta la tarjeta como JPEG.
 *
 * `ImageResponse` solo sabe emitir PNG, y un PNG de 1200x630 con una
 * foto dentro pesa más de 1 MB — mal negocio para algo que un scraper de
 * enlaces descarga antes de decidir si muestra la miniatura. En JPEG la
 * misma tarjeta baja a un orden de magnitud menos sin diferencia
 * visible: son fotos, no capturas de texto plano.
 *
 * Si la recodificación falla se devuelve el PNG tal cual, que sigue
 * siendo una tarjeta válida.
 */
async function asJpeg(png: ImageResponse): Promise<Response> {
  try {
    const buf = Buffer.from(await png.arrayBuffer());
    const jpeg = await sharp(buf)
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer();
    return new Response(new Uint8Array(jpeg), {
      headers: {
        'Content-Type': 'image/jpeg',
        'Content-Length': String(jpeg.length),
      },
    });
  } catch {
    return png;
  }
}

/**
 * La foto del vehículo, lista para que Satori la dibuje.
 *
 * Existe por un motivo muy concreto: las fotos se suben convertidas a
 * WebP (ver `lib/storage/compress-image.ts`), y el motor de `next/og`
 * **no sabe decodificar WebP**. No falla: dibuja el hueco vacío. Eso es
 * lo que hacía que un enlace compartido por WhatsApp mostrara la tarjeta
 * con el precio pero sin el auto.
 *
 * Se resuelve igual que en la publicación a Instagram —con sharp— pero
 * acá la copia no se guarda en el bucket: se recorta al tamaño exacto de
 * la tarjeta y se devuelve como data URI. Recortar acá y no con
 * `objectFit` deja a Satori sin nada que interpretar.
 *
 * **Nunca lanza**: si la foto no se puede descargar o convertir, la
 * tarjeta sale solo con texto, que es lo que pasaba antes. Un enlace sin
 * previsualización es mucho peor que uno con la previsualización sobria.
 */
async function photoDataUri(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const jpeg = await sharp(Buffer.from(await res.arrayBuffer()))
      .resize(size.width, size.height, { fit: 'cover' })
      // Sin `flatten`, un PNG con transparencia sale con fondo negro.
      .flatten({ background: CARD_BG })
      .jpeg({ quality: 78 })
      .toBuffer();
    return `data:image/jpeg;base64,${jpeg.toString('base64')}`;
  } catch {
    return null;
  }
}

// OG image dinámica por vehículo: foto principal + marca/modelo/año +
// precio, para que los enlaces compartidos (WhatsApp, redes) muestren el
// auto. Si no hay foto, renderiza una tarjeta con solo texto.
//
// Dinámica como la ficha que acompaña: el precio cambia, y una imagen
// prerenderizada anunciaría en WhatsApp un precio que ya no es el vigente.
export const dynamic = 'force-dynamic';
export default async function OgImage({ params }: Params) {
  const { id } = await params;
  const data = await getShowcaseVehicle(id);

  if (!data) {
    return asJpeg(
      new ImageResponse(
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: CARD_BG,
            color: 'white',
            fontSize: 48,
            fontFamily: 'sans-serif',
          }}
        >
          Vehículo
        </div>,
        { ...size }
      )
    );
  }

  const { account, vehicle: v } = data;
  const name = account.public_name?.trim() || account.name;
  const source = v.images?.[0];
  const photo = source ? await photoDataUri(source) : null;
  // Satori (next/og) exige `display: flex` en cualquier div con más de un
  // hijo. Interpolar varias expresiones en una línea genera un nodo de
  // texto por cada una, así que se arman aquí como cadena única.
  const title = `${v.brand} ${v.model} ${v.year}`;
  const price = formatPrice(v.price, account.default_currency);

  return asJpeg(
    new ImageResponse(
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          position: 'relative',
          background: CARD_BG,
          color: 'white',
          fontFamily: 'sans-serif',
        }}
      >
        {/* La foto va a sangre y no en media tarjeta porque WhatsApp
            recorta la previsualización a un cuadrado: con la foto en un
            costado, la miniatura podía quedarse toda en el texto. Así
            cualquier recorte muestra el auto. */}
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photo}
            width={size.width}
            height={size.height}
            style={{ position: 'absolute', top: 0, left: 0 }}
            alt=""
          />
        ) : null}
        {/* Degradado que oscurece la mitad de abajo: sin él, el texto se
            pierde sobre una foto clara. */}
        {photo ? (
          <div
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 0,
              height: 400,
              display: 'flex',
              backgroundImage: `linear-gradient(to bottom, rgba(15,23,42,0), rgba(15,23,42,0.92))`,
            }}
          />
        ) : null}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            // Con foto el texto se apoya abajo, sobre el degradado; sin
            // foto se centra, que es como se veía la tarjeta sobria.
            justifyContent: photo ? 'flex-end' : 'center',
            flex: 1,
            padding: 60,
          }}
        >
          <div style={{ fontSize: 28, opacity: 0.85 }}>{name}</div>
          <div
            style={{
              fontSize: 58,
              fontWeight: 800,
              marginTop: 16,
              lineHeight: 1.1,
            }}
          >
            {title}
          </div>
          <div
            style={{
              fontSize: 56,
              fontWeight: 800,
              marginTop: 24,
              color: '#4ade80',
            }}
          >
            {price}
          </div>
        </div>
      </div>,
      { ...size }
    )
  );
}
