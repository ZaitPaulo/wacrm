import { describe, it, expect } from 'vitest';
import {
  makeCoverImage,
  photoCutoff,
  reorderImages,
} from '@/lib/inventory/photo-order';

const PHOTOS = ['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg', 'e.jpg'];

describe('reorderImages', () => {
  it('mueve una foto hacia adelante desplazando el resto', () => {
    expect(reorderImages(PHOTOS, 3, 1)).toEqual([
      'a.jpg',
      'd.jpg',
      'b.jpg',
      'c.jpg',
      'e.jpg',
    ]);
  });

  it('mueve una foto hacia atrás desplazando el resto', () => {
    expect(reorderImages(PHOTOS, 0, 3)).toEqual([
      'b.jpg',
      'c.jpg',
      'd.jpg',
      'a.jpg',
      'e.jpg',
    ]);
  });

  it('no pierde ni duplica fotos', () => {
    const moved = reorderImages(PHOTOS, 4, 0);
    expect(moved).toHaveLength(PHOTOS.length);
    expect([...moved].sort()).toEqual([...PHOTOS].sort());
  });

  it('no muta el arreglo original', () => {
    const original = [...PHOTOS];
    reorderImages(PHOTOS, 0, 4);
    expect(PHOTOS).toEqual(original);
  });

  it('devuelve el mismo arreglo cuando origen y destino coinciden', () => {
    expect(reorderImages(PHOTOS, 2, 2)).toBe(PHOTOS);
  });

  // Un arrastre sobre algo que ya no está es un no-evento, no un error:
  // la cola se recarga sola y la foto pudo desaparecer entremedio.
  it('ignora índices fuera de rango en vez de lanzar', () => {
    expect(reorderImages(PHOTOS, -1, 2)).toBe(PHOTOS);
    expect(reorderImages(PHOTOS, 2, 99)).toBe(PHOTOS);
  });

  it('soporta fotos repetidas sin perder ninguna', () => {
    const dupes = ['a.jpg', 'b.jpg', 'a.jpg'];
    expect(reorderImages(dupes, 2, 0)).toEqual(['a.jpg', 'a.jpg', 'b.jpg']);
  });
});

describe('makeCoverImage', () => {
  it('lleva la elegida al frente conservando el orden relativo del resto', () => {
    expect(makeCoverImage(PHOTOS, 3)).toEqual([
      'd.jpg',
      'a.jpg',
      'b.jpg',
      'c.jpg',
      'e.jpg',
    ]);
  });

  it('deja todo igual si ya era la portada', () => {
    expect(makeCoverImage(PHOTOS, 0)).toBe(PHOTOS);
  });

  it('rescata la última foto, que es el caso incómodo de arrastrar', () => {
    expect(makeCoverImage(PHOTOS, 4)[0]).toBe('e.jpg');
  });
});

describe('photoCutoff', () => {
  it('no señala corte cuando todas las fotos entran', () => {
    expect(photoCutoff(4, [10, 10])).toBeNull();
  });

  it('no señala corte cuando la cantidad iguala al máximo', () => {
    expect(photoCutoff(10, [10])).toBeNull();
  });

  // Una foto que una red no publica ya está fuera de algo: esconderlo
  // detrás del máximo más generoso sería mentir sobre la red más chica.
  it('usa el máximo más estricto de las redes', () => {
    expect(photoCutoff(9, [10, 5])).toBe(5);
  });

  it('señala el corte cuando sobran fotos', () => {
    expect(photoCutoff(15, [10])).toBe(10);
  });

  it('no señala nada si no se conoce ningún máximo', () => {
    expect(photoCutoff(15, [])).toBeNull();
  });

  it('ignora máximos inválidos', () => {
    expect(photoCutoff(15, [0, Number.NaN, 10])).toBe(10);
  });
});
