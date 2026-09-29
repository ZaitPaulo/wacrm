import { describe, expect, it } from 'vitest';
import { composeVehiclePost } from './compose';
import type { VehicleForCaption } from './caption';
import { INSTAGRAM_LIMITS, MAX_CAROUSEL_ITEMS } from './instagram/limits';
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

const DEFAULT_TEMPLATE = esMessages.SocialPost.defaultTemplate;

const IMAGES = [
  'https://cdn.example.com/1.jpg',
  'https://cdn.example.com/2.jpg',
];

describe('composeVehiclePost', () => {
  const base = {
    vehicle: FULL_VEHICLE,
    account: ACCOUNT,
    t,
    defaultTemplate: DEFAULT_TEMPLATE,
    limits: INSTAGRAM_LIMITS,
  };

  it('devuelve el texto y las imágenes en orden', () => {
    const result = composeVehiclePost({ ...base, images: IMAGES });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.imageUrls).toEqual(IMAGES);
    expect(result.caption).toContain('MAZDA 3 GRAND TOURING 🚘');
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

  // El orden de `images` es el que eligió una persona arrastrando las
  // fotos, no el de subida. Componer tiene que respetarlo tal cual:
  // Instagram encuadra todo el carrusel según la primera.
  it('respeta un orden reordenado en vez de reacomodar', () => {
    const reordered = [...IMAGES].reverse();
    const result = composeVehiclePost({ ...base, images: reordered });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.imageUrls).toEqual(reordered);
  });

  // Y como el recorte es por el final, ese orden decide CUÁLES fotos
  // llegan a publicarse: mover una al frente la mete en el carrusel.
  it('publica la foto que se movió al frente y descarta la que quedó última', () => {
    const many = Array.from(
      { length: 12 },
      (_, i) => `https://cdn.example.com/${i}.jpg`
    );
    const promoted = [many[11], ...many.slice(0, 11)];
    const result = composeVehiclePost({ ...base, images: promoted });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.imageUrls[0]).toBe('https://cdn.example.com/11.jpg');
    expect(result.imageUrls).not.toContain('https://cdn.example.com/9.jpg');
    expect(result.imageUrls).not.toContain('https://cdn.example.com/10.jpg');
  });
});
