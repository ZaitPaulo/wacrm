import { describe, expect, it } from 'vitest';
import {
  buildVehicleCaption,
  unknownTemplateVariables,
  type AccountForCaption,
  type VehicleForCaption,
} from './caption';
import { validateCaption } from './limits';
import { INSTAGRAM_LIMITS } from './instagram/limits';
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

// La plantilla por defecto también sale del catálogo real, cruda, como
// la lee `t.raw` en la cola.
const DEFAULT_TEMPLATE = esMessages.SocialPost.defaultTemplate;

// El vehículo de la captura que mandó el cliente.
const SPARK: VehicleForCaption = {
  brand: 'CHEVROLET',
  model: 'SPARK GT',
  year: 2017,
  price: 35000000,
  warranty_price: 37100000,
  mileage: 152000,
  transmission: 'manual',
  engine_displacement: '1.2',
  plate_city: 'BARRANQUILLA',
  soat_expires_at: '2026-11-03',
  tecnomecanica_expires_at: '2026-10-27',
};

const ACCOUNT: AccountForCaption = {
  default_currency: 'COP',
  public_name: 'LoraMotors',
  public_address: 'Cra. 44 # 63-05, Barranquilla',
  public_whatsapp: '+57 300 1234567',
  public_phone: null,
  public_email: null,
  social_post_template: null,
};

function build(
  vehicle: VehicleForCaption = SPARK,
  account: AccountForCaption = ACCOUNT
): string {
  return buildVehicleCaption({
    vehicle,
    account,
    t,
    defaultTemplate: DEFAULT_TEMPLATE,
  });
}

describe('buildVehicleCaption — la plantilla por defecto', () => {
  // La prueba fuerte del módulo: el texto ENTERO, línea por línea, como
  // lo pidió el cliente. Si alguien "mejora" el orden o la puntuación de
  // la plantilla por defecto, esto se cae acá y no en el feed.
  it('sale exactamente como lo pidió el negocio', () => {
    expect(build()).toBe(
      [
        'CHEVROLET SPARK GT 🚘',
        'MODELO 2017',
        '152.000 KM',
        'MECÁNICO',
        'MOTOR 1.2',
        'PLACAS DE BARRANQUILLA',
        '🚩 SOAT: 03 NOV 2026',
        '🚩 TECNO: 27 OCT 2026',
        `PRECIO DE VENTA:  ${formatPrice(37100000, 'COP')}`,
        'GARANTÍA INCLUIDA POR 12 MESES',
        '..................................................',
        '¡PUEDES LLEVARTELO hasta con el 100% ✅FINANCIADO!',
        'Cra. 44 # 63-05, Barranquilla',
        '¡Agenda tu cita ya! CONTACTANOS...',
        '📞 +57 300 1234567',
        '#CarrosBarranquilla #CarrosEnVenta #CarrosUsados',
        '#Vehiculosbarranquilla',
        'LoraMotors',
      ].join('\n')
    );
  });

  it('publica un solo precio: el de garantía', () => {
    const caption = build();
    expect(caption).toContain(formatPrice(37100000, 'COP'));
    expect(caption).not.toContain(formatPrice(35000000, 'COP'));
    expect(caption).not.toContain('PRECIO CON GARANTIA');
  });

  it('cae al precio de venta cuando no hay precio con garantía', () => {
    const caption = build({ ...SPARK, warranty_price: null });
    expect(caption).toContain(
      `PRECIO DE VENTA:  ${formatPrice(35000000, 'COP')}`
    );
  });

  it('una plantilla vacía o en blanco equivale a la de defecto', () => {
    expect(build(SPARK, { ...ACCOUNT, social_post_template: '  \n ' })).toBe(
      build()
    );
  });

  it('cabe en los límites de Instagram', () => {
    expect(validateCaption(build(), INSTAGRAM_LIMITS)).toBeNull();
  });
});

describe('buildVehicleCaption — las fechas de los documentos', () => {
  it('no corre el vencimiento un día por el huso horario', () => {
    // `new Date('2026-11-03')` es medianoche UTC: formateado en
    // Barranquilla (UTC-5) daría el 2 de noviembre.
    const caption = build();
    expect(caption).toContain('🚩 SOAT: 03 NOV 2026');
    expect(caption).not.toContain('02 NOV');
  });

  it('escribe NA cuando el documento falta, en vez de omitir la línea', () => {
    expect(build({ ...SPARK, tecnomecanica_expires_at: null })).toContain(
      '🚩 TECNO: NA'
    );
  });

  it('no se traga una fecha con formato inesperado', () => {
    const caption = build({ ...SPARK, soat_expires_at: '26/11/2026' });
    expect(caption).toContain('🚩 SOAT: NA');
    expect(caption).not.toContain('26/11/2026');
  });
});

describe('buildVehicleCaption — lo ausente se omite', () => {
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

  it('se arma igual, sin las líneas que no tienen dato', () => {
    const caption = build(BARE);

    expect(caption).toContain('RENAULT LOGAN 🚘');
    expect(caption).toContain('MODELO 2015');
    expect(caption).not.toContain('KM');
    expect(caption).not.toContain('MOTOR');
    expect(caption).not.toContain('PLACAS DE');
    expect(caption).not.toContain('undefined');
    expect(caption).not.toContain('null');
    expect(caption).not.toMatch(/\{\w+\}/);
    expect(caption).not.toMatch(/\n{2,}/);
  });

  it('omite la transmisión que no dice nada', () => {
    const caption = build({ ...BARE, transmission: 'other' });
    expect(caption).not.toContain('transmission');
    expect(caption).not.toContain('\n\n');
  });

  it('sigue publicando aunque el negocio no tenga dirección ni nombre', () => {
    const caption = build(SPARK, {
      ...ACCOUNT,
      public_address: null,
      public_name: null,
    });
    expect(caption).toContain('¡Agenda tu cita ya!');
    expect(caption).not.toMatch(/\n{2,}/);
    expect(caption.endsWith('#Vehiculosbarranquilla')).toBe(true);
  });
});

describe('buildVehicleCaption — plantilla propia de la cuenta', () => {
  const custom = (template: string, vehicle: VehicleForCaption = SPARK) =>
    build(vehicle, { ...ACCOUNT, social_post_template: template });

  it('usa la plantilla de la cuenta en vez de la de defecto', () => {
    expect(custom('{marca} {modelo} ({año})\nSOLO {precio}')).toBe(
      `CHEVROLET SPARK GT (2017)\nSOLO ${formatPrice(37100000, 'COP')}`
    );
  });

  it('ofrece el precio sin garantía como variable aparte', () => {
    expect(custom('{precio_sin_garantia}')).toBe(formatPrice(35000000, 'COP'));
  });

  it('acepta {anio} como alias de {año}', () => {
    expect(custom('MODELO {anio}')).toBe('MODELO 2017');
  });

  it('omite la línea entera si cualquiera de sus variables falta', () => {
    expect(
      custom('{marca}\n{kilometraje} KM - {motor}', {
        ...SPARK,
        engine_displacement: null,
      })
    ).toBe('CHEVROLET');
  });

  it('respeta las líneas en blanco que separan bloques', () => {
    expect(custom('{marca}\n\nFIJO')).toBe('CHEVROLET\n\nFIJO');
  });

  it('acepta saltos de línea de Windows', () => {
    expect(custom('{marca}\r\n{modelo}')).toBe('CHEVROLET\nSPARK GT');
  });
});

describe('buildVehicleCaption — contacto', () => {
  it('invita por el canal público configurado', () => {
    expect(build()).toContain('📞 +57 300 1234567');
  });

  it('cae al teléfono cuando no hay WhatsApp', () => {
    expect(
      build(SPARK, { ...ACCOUNT, public_whatsapp: null, public_phone: '6011234' })
    ).toContain('📞 6011234');
  });

  it('no inventa datos cuando no hay ningún canal', () => {
    // Un número equivocado en el feed manda al interesado a un teléfono
    // que el CRM no escucha: ese prospecto no existe para nadie.
    const caption = build(SPARK, {
      ...ACCOUNT,
      public_whatsapp: null,
      public_phone: null,
      public_email: null,
    });
    expect(caption).toContain('Escríbenos para más información');
    expect(caption).not.toMatch(/\+?\d{7,}/);
  });
});

describe('el dato reservado nunca llega a la publicación', () => {
  // El costo de compra vive en `vehicle_acquisitions` (migración 508) y
  // no en el vehículo, así que la garantía real es que VehicleForCaption
  // no lo admite y el catálogo de variables no lo nombra.
  const CONTAMINATED = {
    ...SPARK,
    purchase_cost: 61000000,
    internal_notes: 'Comprado a Jorge, margen ajustado. Pintura del capó.',
    vin: '1HGBH41JXMN109186',
    license_plate: 'ABC123',
  } as VehicleForCaption;

  it('no incluye costo, notas, VIN ni placa con la plantilla por defecto', () => {
    const caption = build(CONTAMINATED);
    for (const secret of ['61.000.000', 'Jorge', '1HGBH41JXMN109186', 'ABC123']) {
      expect(caption).not.toContain(secret);
    }
  });

  it('tampoco los expone una plantilla que intente nombrarlos', () => {
    const caption = build(CONTAMINATED, {
      ...ACCOUNT,
      social_post_template: '{purchase_cost} {internal_notes} {vin} {license_plate}',
    });
    expect(caption).not.toContain('61000000');
    expect(caption).not.toContain('Jorge');
    expect(caption).not.toContain('ABC123');
  });
});

describe('unknownTemplateVariables', () => {
  it('no marca nada en la plantilla por defecto', () => {
    expect(unknownTemplateVariables(DEFAULT_TEMPLATE)).toEqual([]);
  });

  it('acepta el alias {anio}', () => {
    expect(unknownTemplateVariables('{anio}')).toEqual([]);
  });

  it('devuelve las variables mal escritas, sin repetir', () => {
    expect(
      unknownTemplateVariables('{precio_garantia} {marca} {precio_garantia} {vin}')
    ).toEqual(['precio_garantia', 'vin']);
  });
});
