import { describe, expect, it } from 'vitest';
import { layoutColumn } from './layout';

const at = (h: number, m = 0) => new Date(2026, 9, 6, h, m);

describe('layoutColumn', () => {
  it('citas separadas usan un carril cada una', () => {
    const r = layoutColumn([
      { id: 'a', starts_at: at(9), ends_at: at(9, 30) },
      { id: 'b', starts_at: at(9, 30), ends_at: at(10) },
    ]);
    expect(r.get('a')).toEqual({ lane: 0, lanes: 1 });
    expect(r.get('b')).toEqual({ lane: 0, lanes: 1 });
  });

  it('dos que se cruzan se reparten el ancho', () => {
    const r = layoutColumn([
      { id: 'a', starts_at: at(9), ends_at: at(10) },
      { id: 'b', starts_at: at(9, 30), ends_at: at(10) },
    ]);
    expect(r.get('a')).toEqual({ lane: 0, lanes: 2 });
    expect(r.get('b')).toEqual({ lane: 1, lanes: 2 });
  });

  it('reutiliza un carril que se liberó dentro del grupo', () => {
    const r = layoutColumn([
      { id: 'a', starts_at: at(9), ends_at: at(11) },
      { id: 'b', starts_at: at(9), ends_at: at(9, 30) },
      { id: 'c', starts_at: at(10), ends_at: at(10, 30) },
    ]);
    expect(r.get('a')?.lane).toBe(0);
    expect(r.get('b')?.lane).toBe(1);
    expect(r.get('c')?.lane).toBe(1);
    expect(r.get('c')?.lanes).toBe(2);
  });

  it('un grupo nuevo vuelve a un solo carril', () => {
    const r = layoutColumn([
      { id: 'a', starts_at: at(9), ends_at: at(10) },
      { id: 'b', starts_at: at(9), ends_at: at(10) },
      { id: 'c', starts_at: at(14), ends_at: at(14, 30) },
    ]);
    expect(r.get('c')).toEqual({ lane: 0, lanes: 1 });
  });
});
