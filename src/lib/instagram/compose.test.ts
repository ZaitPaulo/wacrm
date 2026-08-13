import { describe, expect, it } from 'vitest';
import { composeVehiclePost } from './compose';
import { buildVehicleCaption, type VehicleForCaption } from './caption';
import { MAX_CAROUSEL_ITEMS, validateCaption } from './limits';
import { formatPrice } from '@/lib/showcase/format';

// Traductores de prueba: devuelven algo legible y determinista sin
// montar next-intl. Interpolan igual que el real.
const t = (key: string, values?: Record<string, string>) => {
  const messages: Record<string, string> = {
    price: 'Precio: {value}',
    mileage: 'Kilometraje: {value} km',
    plateCity: 'Matriculado en {value}',
    acceptsTradeIn: 'Recibimos tu usado',
    contact: 'Escríbenos: {channel}',
    contactGeneric: 'Escríbenos para más información',
  };
  let out = messages[key] ?? key;
  for (const [k, v] of Object.entries(values ?? {})) {
    out = out.replace(`{${k}}`, v);
  }
  return out;
};

// El de especificaciones devuelve la última parte de la clave, que
// alcanza para verificar que se usó el catálogo y no el valor crudo.
const tSpecs = (key: string) => key.split('.').pop() ?? key;

const FULL_VEHICLE: VehicleForCaption = {
  brand: 'Mazda',
  model: '3 Grand Touring',
  year: 2019,
  price: 78500000,
  mileage: 45300,
  transmission: 'automatic',
  fuel_type: 'gasoline',
  body_type: 'sedan',
  condition: 'used',
  engine_displacement: '2.0',
  plate_city: 'Bogotá',
  accepts_trade_in: true,
};

const ACCOUNT = {
  default_currency: 'COP',
  public_whatsapp: '+57 300 1234567',
  public_phone: null,
  public_email: null,
};

const IMAGES = [
  'https://cdn.example.com/1.jpg',
  'https://cdn.example.com/2.jpg',
];

describe('buildVehicleCaption — ficha completa', () => {
  it('incluye marca, línea, año, precio y kilometraje', () => {
    const caption = buildVehicleCaption({
      vehicle: FULL_VEHICLE,
      account: ACCOUNT,
      t,
      tSpecs,
    });

    expect(caption).toContain('Mazda 3 Grand Touring 2019');
    expect(caption).toContain('Precio: $78.500.000');
    expect(caption).toContain('Kilometraje: 45.300 km');
  });

  it('usa el mismo formato de precio que la vitrina', () => {
    // Si esto se rompe, la publicación y la vitrina se contradicen
    // sobre el precio del mismo auto.
    const caption = buildVehicleCaption({
      vehicle: FULL_VEHICLE,
      account: ACCOUNT,
      t,
      tSpecs,
    });
    expect(caption).toContain(formatPrice(FULL_VEHICLE.price, 'COP'));
  });

  it('respeta la moneda de la cuenta', () => {
    const caption = buildVehicleCaption({
      vehicle: FULL_VEHICLE,
      account: { ...ACCOUNT, default_currency: 'USD' },
      t,
      tSpecs,
    });
    expect(caption).toContain('$78.500.000');
    expect(caption).not.toContain('COP');
  });

  it('traduce la ficha técnica en vez de mostrar el valor crudo', () => {
    const caption = buildVehicleCaption({
      vehicle: FULL_VEHICLE,
      account: ACCOUNT,
      t,
      tSpecs,
    });
    expect(caption).toContain('automatic');
    expect(caption).toContain('gasoline');
    expect(caption).toContain('sedan');
  });

  it('menciona la ciudad de matrícula', () => {
    const caption = buildVehicleCaption({
      vehicle: FULL_VEHICLE,
      account: ACCOUNT,
      t,
      tSpecs,
    });
    expect(caption).toContain('Matriculado en Bogotá');
  });

  it('cabe en los límites de Instagram', () => {
    const caption = buildVehicleCaption({
      vehicle: FULL_VEHICLE,
      account: ACCOUNT,
      t,
      tSpecs,
    });
    expect(validateCaption(caption)).toBeNull();
  });
});

describe('buildVehicleCaption — ficha parcial', () => {
  const BARE: VehicleForCaption = {
    brand: 'Renault',
    model: 'Logan',
    year: 2015,
    price: 32000000,
    mileage: null,
    transmission: null,
    fuel_type: null,
    body_type: null,
    condition: null,
    engine_displacement: null,
    plate_city: null,
    accepts_trade_in: false,
  };

  it('se arma igual, omitiendo lo ausente', () => {
    const caption = buildVehicleCaption({
      vehicle: BARE,
      account: ACCOUNT,
      t,
      tSpecs,
    });

    expect(caption).toContain('Renault Logan 2015');
    expect(caption).toContain('Precio: $32.000.000');
  });

  it('no deja marcadores ni líneas vacías por los datos faltantes', () => {
    const caption = buildVehicleCaption({
      vehicle: BARE,
      account: ACCOUNT,
      t,
      tSpecs,
    });

    expect(caption).not.toContain('Kilometraje');
    expect(caption).not.toContain('Matriculado');
    expect(caption).not.toContain('undefined');
    expect(caption).not.toContain('null');
    expect(caption).not.toMatch(/^\s*[-—]\s*$/m);
    // Ninguna línea en blanco de más: como mucho una separación doble.
    expect(caption).not.toMatch(/\n{3,}/);
  });
});

describe('buildVehicleCaption — contacto', () => {
  it('invita por el canal público configurado', () => {
    const caption = buildVehicleCaption({
      vehicle: FULL_VEHICLE,
      account: ACCOUNT,
      t,
      tSpecs,
    });
    expect(caption).toContain('Escríbenos: +57 300 1234567');
  });

  it('cae al teléfono cuando no hay WhatsApp', () => {
    const caption = buildVehicleCaption({
      vehicle: FULL_VEHICLE,
      account: { ...ACCOUNT, public_whatsapp: null, public_phone: '6011234' },
      t,
      tSpecs,
    });
    expect(caption).toContain('Escríbenos: 6011234');
  });

  it('no inventa datos cuando no hay ningún canal', () => {
    const caption = buildVehicleCaption({
      vehicle: FULL_VEHICLE,
      account: {
        default_currency: 'COP',
        public_whatsapp: null,
        public_phone: null,
        public_email: null,
      },
      t,
      tSpecs,
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
  } as VehicleForCaption;

  it('no incluye el costo de compra ni el margen', () => {
    const caption = buildVehicleCaption({
      vehicle: CONTAMINATED,
      account: ACCOUNT,
      t,
      tSpecs,
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
      tSpecs,
    });
    expect(caption).not.toContain('Jorge');
    expect(caption).not.toContain('Pintura');
  });

  it('no incluye VIN ni placa', () => {
    const caption = buildVehicleCaption({
      vehicle: CONTAMINATED,
      account: ACCOUNT,
      t,
      tSpecs,
    });
    expect(caption).not.toContain('1HGBH41JXMN109186');
    expect(caption).not.toContain('ABC123');
  });
});

describe('composeVehiclePost', () => {
  const base = { vehicle: FULL_VEHICLE, account: ACCOUNT, t, tSpecs };

  it('devuelve el texto y las imágenes en orden', () => {
    const result = composeVehiclePost({ ...base, images: IMAGES });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.imageUrls).toEqual(IMAGES);
    expect(result.caption).toContain('Mazda 3 Grand Touring 2019');
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
