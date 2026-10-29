import { describe, it, expect } from 'vitest';
import {
  MAX_BATCH_IMAGES,
  selectBatchImages,
  type BatchCandidate,
} from './image-batch';

const MAX_BYTES = 5 * 1024 * 1024;

function file(
  name: string,
  type = 'image/jpeg',
  size = 1024
): BatchCandidate {
  return { name, type, size };
}

function photos(count: number, prefix = 'foto'): BatchCandidate[] {
  return Array.from({ length: count }, (_, i) => file(`${prefix}-${i}.jpg`));
}

describe('selectBatchImages', () => {
  it('acepta hasta el tope exacto en una tanda vacía', () => {
    const picked = photos(MAX_BATCH_IMAGES);

    const result = selectBatchImages(picked, 0, MAX_BYTES);

    expect(result.accepted).toEqual(picked);
    expect(result.overLimit).toEqual([]);
  });

  it('con 8 en preparación y 5 nuevas, entran las 2 primeras', () => {
    const picked = photos(5, 'nueva');

    const result = selectBatchImages(picked, 8, MAX_BYTES);

    expect(result.accepted.map((f) => f.name)).toEqual([
      'nueva-0.jpg',
      'nueva-1.jpg',
    ]);
    expect(result.overLimit).toHaveLength(3);
  });

  it('con la tanda llena no entra ninguna', () => {
    const result = selectBatchImages(photos(2), MAX_BATCH_IMAGES, MAX_BYTES);

    expect(result.accepted).toEqual([]);
    expect(result.overLimit).toHaveLength(2);
  });

  it('separa un PDF soltado junto a una foto', () => {
    const pdf = file('ficha.pdf', 'application/pdf');
    const jpg = file('frente.jpg');

    const result = selectBatchImages([pdf, jpg], 0, MAX_BYTES);

    expect(result.accepted).toEqual([jpg]);
    expect(result.wrongType).toEqual([pdf]);
  });

  it('rechaza por peso sin quitarle cupo a las válidas', () => {
    const heavy = file('pesada.jpg', 'image/jpeg', MAX_BYTES + 1);
    const ok = file('liviana.png', 'image/png');

    const result = selectBatchImages([heavy, ok], MAX_BATCH_IMAGES - 1, MAX_BYTES);

    expect(result.tooLarge).toEqual([heavy]);
    expect(result.accepted).toEqual([ok]);
    expect(result.overLimit).toEqual([]);
  });

  it('una selección vacía no devuelve nada', () => {
    expect(selectBatchImages([], 3, MAX_BYTES)).toEqual({
      accepted: [],
      wrongType: [],
      tooLarge: [],
      overLimit: [],
    });
  });
});
