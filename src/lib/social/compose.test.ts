import { describe, expect, it } from 'vitest';
import { composeVehiclePost } from './compose';
import { buildVehicleCaption, type VehicleForCaption } from './caption';
import { validateCaption } from './limits';
import { INSTAGRAM_LIMITS, MAX_CAROUSEL_ITEMS } from './instagram/limits';
import { formatPrice } from '@/lib/showcase/format';
import esMessages from '../../../messages/es.json';

// El traductor de prueba lee el catálogo REAL en vez de una copia.
// Con un mapa propio, borrar una clave de es.json dejaría los tests en
// verde y la publicación saldría con el nombre de la clave en el feed.
// Interpola y resuelve claves anidadas igual que next-intl.
const t = (key: string, values?: Record<string, string>) => {
  const found = key
    .split('.')
    .reduce<unknown>(
      (node, part) =>
        node && typeof node === 'object'
          ? (node as Record<string, unknown>)[part]
          : undefined,
      esMessages.SocialPost
    );
  let out = typeof found === 'string' ? found : key;
  for (const [k, v] of Object.entries(values ?? {})) {
    out = out.replace(`{${k}}`, v);
  }
  return out;
};

const FULL_VEHICLE: VehicleForCaption = {
  brand: 'MAZDA',
  model: '3 GRAND TOURING',
  year: 2019,
  price: 78500000,
  warranty_price: 80000000,
  mileage: 45300,
  transmission: 'automatic',
  engine_displacement: '2.0',
  plate_city: 'BOGOTÁ',
  soat_expires_at: '2027-03-06',
  tecnomecanica_expires_at: '2026-11-27',
};

const ACCOUNT = {
  default_currency: 'COP',
  public_name: 'LoraMotors',
  public_address: 'Cra. 44 # 63-05, Barranquilla',
  public_whatsapp: '+57 300 1234567',
  public_phone: null,
  public_email: null,
};

const IMAGES = [
  'https://cdn.example.com/1.jpg',
  'https://cdn.example.com/2.jpg',
];

describe('buildVehicleCaption — el formato que el negocio ya usaba', () => {
  // La prueba fuerte del módulo: el texto ENTERO, línea por línea. El
  // cliente venía publicando así a mano y una publicación que se ve
  // distinta a las de al lado se lee como ajena. Si alguien "mejora" el
  // orden o la puntuación, esto se cae acá y no en el feed.
  it('sale exactamente como lo publica el negocio', () => {
    const caption = buildVehicleCaption({
      vehicle: FULL_VEHICLE,
      account: ACCOUNT,
      t,
    });

    expect(caption).toBe(
      [
        'MAZDA 3 GRAND TOURING 🚗',
        'MODELO 2019',
        '45.300KM',
        'AUTOMÁTICO',
        'MOTOR 2.0',
        'PLACAS DE BOGOTÁ',
        '🚩 SOAT: 06 MAR 2027',
        '🚩 TECNO: 27 NOV 2026',
        'PRECIO DE VENTA: $78.500.000',
        'PRECIO CON GARANTIA: $80.000.000',
        '..................................................',
        '¡PUEDES LLEVARTELO hasta con el 100% ✅FINANCIADO!',
        'Cra. 44 # 63-05, Barranquilla',
        '¡Agenda tu cita ya! CONTACTANOS...',
        '📞 +57 300 1234567',
        '#CarrosBarranquilla #CarrosEnVenta #CarrosUsados',
        '#Vehiculosbarranquilla LoraMotors',
      ].join('\n')
    );
  });

  it('usa el mismo formato de precio que la vitrina', () => {
    // Si esto se rompe, la publicación y la vitrina se contradicen
    // sobre el precio del mismo auto.
    const caption = buildVehicleCaption({
      vehicle: FULL_VEHICLE,
      account: ACCOUNT,
      t,
    });
    expect(caption).toContain(formatPrice(FULL_VEHICLE.price, 'COP'));
  });

  it('respeta la moneda de la cuenta', () => {
    const caption = buildVehicleCaption({
      vehicle: FULL_VEHICLE,
      account: { ...ACCOUNT, default_currency: 'USD' },
      t,
    });
    expect(caption).toContain('$78.500.000');
    expect(caption).not.toContain('COP');
  });

  it('cabe en los límites de Instagram', () => {
    const caption = buildVehicleCaption({
      vehicle: FULL_VEHICLE,
      account: ACCOUNT,
      t,
    });
    expect(validateCaption(caption, INSTAGRAM_LIMITS)).toBeNull();
  });
});

describe('buildVehicleCaption — las fechas de los documentos', () => {
  it('no corre el vencimiento un día por el huso horario', () => {
    // `new Date('2027-03-06')` es medianoche UTC: formateado en
    // Barranquilla (UTC-5) daría el 5 de marzo. Un SOAT que vence un
    // día antes de lo que dice el papel no es un detalle.
    const caption = buildVehicleCaption({
      vehicle: FULL_VEHICLE,
      account: ACCOUNT,
      t,
    });
    expect(caption).toContain('🚩 SOAT: 06 MAR 2027');
    expect(caption).not.toContain('05 MAR');
  });

  it('escribe NA cuando el documento falta, en vez de omitir la línea', () => {
    // Acá el vacío ES la respuesta —el vehículo no tiene tecno vigente—
    // y así lo publica el negocio. Omitir la línea haría dudar al
    // comprador en vez de informarlo.
    const caption = buildVehicleCaption({
      vehicle: { ...FULL_VEHICLE, tecnomecanica_expires_at: null },
      account: ACCOUNT,
      t,
    });
    expect(caption).toContain('🚩 TECNO: NA');
  });

  it('no se traga una fecha con formato inesperado', () => {
    const caption = buildVehicleCaption({
      vehicle: { ...FULL_VEHICLE, soat_expires_at: '26/11/2026' },
      account: ACCOUNT,
      t,
    });
    expect(caption).toContain('🚩 SOAT: NA');
    expect(caption).not.toContain('26/11/2026');
  });
});

describe('buildVehicleCaption — ficha parcial', () => {
  const BARE: VehicleForCaption = {
    brand: 'RENAULT',
    model: 'LOGAN',
    year: 2015,
    price: 32000000,
    warranty_price: null,
    mileage: null,
    transmission: null,
    engine_displacement: null,
    plate_city: null,
    soat_expires_at: null,
    tecnomecanica_expires_at: null,
  };

  it('se arma igual, omitiendo lo ausente', () => {
    const caption = buildVehicleCaption({
      vehicle: BARE,
      account: ACCOUNT,
      t,
    });

    expect(caption).toContain('RENAULT LOGAN 🚗');
    expect(caption).toContain('MODELO 2015');
    expect(caption).toContain('PRECIO DE VENTA: $32.000.000');
  });

  it('no deja marcadores ni líneas vacías por los datos faltantes', () => {
    const caption = buildVehicleCaption({
      vehicle: BARE,
      account: ACCOUNT,
      t,
    });

    expect(caption).not.toContain('KM');
    expect(caption).not.toContain('MOTOR');
    expect(caption).not.toContain('PLACAS DE');
    expect(caption).not.toContain('PRECIO CON GARANTIA');
    expect(caption).not.toContain('undefined');
    expect(caption).not.toContain('null');
    expect(caption).not.toMatch(/^\s*[-—]\s*$/m);
    expect(caption).not.toMatch(/\n{2,}/);
  });

  it('omite la transmisión que no dice nada', () => {
    const caption = buildVehicleCaption({
      vehicle: { ...BARE, transmission: 'other' },
      account: ACCOUNT,
      t,
    });
    expect(caption).not.toContain('transmission');
  });

  it('sigue publicando aunque el negocio no tenga dirección cargada', () => {
    const caption = buildVehicleCaption({
      vehicle: FULL_VEHICLE,
      account: { ...ACCOUNT, public_address: null, public_name: null },
      t,
    });
    expect(caption).toContain('¡Agenda tu cita ya!');
    expect(caption).not.toMatch(/\n{2,}/);
    expect(caption.endsWith('#Vehiculosbarranquilla')).toBe(true);
  });
});

describe('buildVehicleCaption — contacto', () => {
  it('invita por el canal público configurado', () => {
    const caption = buildVehicleCaption({
      vehicle: FULL_VEHICLE,
      account: ACCOUNT,
      t,
    });
    expect(caption).toContain('📞 +57 300 1234567');
  });

  it('cae al teléfono cuando no hay WhatsApp', () => {
    const caption = buildVehicleCaption({
      vehicle: FULL_VEHICLE,
      account: { ...ACCOUNT, public_whatsapp: null, public_phone: '6011234' },
      t,
    });
    expect(caption).toContain('📞 6011234');
  });

  it('no inventa datos cuando no hay ningún canal', () => {
    // Un número equivocado en el feed manda al interesado a un teléfono
    // que el CRM no escucha: ese prospecto no existe para nadie.
    const caption = buildVehicleCaption({
      vehicle: FULL_VEHICLE,
      account: {
        ...ACCOUNT,
        public_whatsapp: null,
        public_phone: null,
        public_email: null,
      },
      t,
    });
    expect(caption).toContain('Escríbenos para más información');
    expect(caption).not.toMatch(/\+?\d{7,}/);
  });
});

describe('el dato reservado nunca llega a la publicación', () => {
  // El costo de compra vive en `vehicle_acquisitions` (migración 508) y
  // no en el vehículo, así que la garantía real es que VehicleForCaption
  // no lo admite. Estos tests fijan esa garantía por comportamiento:
  // aunque alguien pase el objeto entero de la base, no se filtra.
  const CONTAMINATED = {
    ...FULL_VEHICLE,
    purchase_cost: 61000000,
    internal_notes: 'Comprado a Jorge, margen ajustado. Pintura del capó.',
    vin: '1HGBH41JXMN109186',
    license_plate: 'ABC123',
    has_lien: true,
  } as VehicleForCaption;

  it('no incluye el costo de compra ni el margen', () => {
    const caption = buildVehicleCaption({
      vehicle: CONTAMINATED,
      account: ACCOUNT,
      t,
    });
    expect(caption).not.toContain('61000000');
    expect(caption).not.toContain('61.000.000');
    expect(caption).not.toContain('margen');
  });

  it('no incluye las notas internas', () => {
    const caption = buildVehicleCaption({
      vehicle: CONTAMINATED,
      account: ACCOUNT,
      t,
    });
    expect(caption).not.toContain('Jorge');
    expect(caption).not.toContain('Pintura');
  });

  it('no incluye VIN ni placa', () => {
    const caption = buildVehicleCaption({
      vehicle: CONTAMINATED,
      account: ACCOUNT,
      t,
    });
    expect(caption).not.toContain('1HGBH41JXMN109186');
    expect(caption).not.toContain('ABC123');
  });
});

describe('composeVehiclePost', () => {
  const base = {
    vehicle: FULL_VEHICLE,
    account: ACCOUNT,
    t,
    limits: INSTAGRAM_LIMITS,
  };

  it('devuelve el texto y las imágenes en orden', () => {
    const result = composeVehiclePost({ ...base, images: IMAGES });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.imageUrls).toEqual(IMAGES);
    expect(result.caption).toContain('MAZDA 3 GRAND TOURING 🚗');
  });

  it('no prepara publicación sin imágenes, y dice por qué', () => {
    const result = composeVehiclePost({ ...base, images: [] });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('no_images');
  });

  it('trata un images nulo igual que uno vacío', () => {
    expect(composeVehiclePost({ ...base, images: null }).ok).toBe(false);
  });

  it('ignora las URLs vacías que hayan quedado en el arreglo', () => {
    const result = composeVehiclePost({ ...base, images: ['', '   '] });
    expect(result.ok).toBe(false);
  });

  it('recorta al máximo del carrusel conservando las primeras', () => {
    const many = Array.from(
      { length: 15 },
      (_, i) => `https://cdn.example.com/${i}.jpg`
    );
    const result = composeVehiclePost({ ...base, images: many });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.imageUrls).toHaveLength(MAX_CAROUSEL_ITEMS);
    expect(result.imageUrls[0]).toBe('https://cdn.example.com/0.jpg');
    expect(result.imageUrls.at(-1)).toBe('https://cdn.example.com/9.jpg');
  });
});
