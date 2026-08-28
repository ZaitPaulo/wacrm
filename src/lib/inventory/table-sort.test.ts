import { describe, expect, it } from 'vitest';
import {
  compareSortValues,
  matchesSearch,
  normalize,
  searchTerms,
} from './table-sort';

// Los datos reales del inventario son colombianos: ciudades con tilde
// ("BOGOTÁ", "MEDELLÍN"), modelos que terminan en número ("ONIX 2",
// "ONIX 10") y columnas donde faltar es normal (un vehículo sin
// kilometraje registrado). Las pruebas van sobre eso, no sobre casos
// inventados.

describe('normalize', () => {
  it('quita tildes y mayúsculas', () => {
    expect(normalize('BOGOTÁ')).toBe('bogota');
    expect(normalize('Medellín')).toBe('medellin');
  });

  it('deja igual lo que ya está sin tildes', () => {
    expect(normalize('BARRANQUILLA')).toBe('barranquilla');
  });

  it('la eñe también se pliega a n', () => {
    // Efecto de descomponer en NFD, y conviene: se aplica a los dos
    // lados de la comparación, así que buscar "narino" encuentra
    // "NARIÑO" y buscar "nariño" también. Nunca se muestra este texto,
    // solo se compara.
    expect(normalize('NARIÑO')).toBe('narino');
    expect(normalize('narino')).toBe('narino');
  });
});

describe('compareSortValues — vacíos', () => {
  it('manda los nulos al final en orden ascendente', () => {
    expect(compareSortValues(null, 100, 'asc')).toBeGreaterThan(0);
    expect(compareSortValues(100, null, 'asc')).toBeLessThan(0);
  });

  it('los manda al final TAMBIÉN en descendente', () => {
    // Lo importante de la columna: invertir el orden no debe subir a
    // primera fila los vehículos sin el dato.
    expect(compareSortValues(null, 100, 'desc')).toBeGreaterThan(0);
    expect(compareSortValues(100, null, 'desc')).toBeLessThan(0);
  });

  it('dos vacíos empatan', () => {
    expect(compareSortValues(null, null, 'asc')).toBe(0);
    expect(compareSortValues(null, null, 'desc')).toBe(0);
  });
});

describe('compareSortValues — números', () => {
  it('ordena kilometrajes de menor a mayor', () => {
    const km = [143800, null, 12800, 98600];
    expect([...km].sort((a, b) => compareSortValues(a, b, 'asc'))).toEqual([
      12800,
      98600,
      143800,
      null,
    ]);
  });

  it('invierte sin mover los vacíos del final', () => {
    const km = [143800, null, 12800, 98600];
    expect([...km].sort((a, b) => compareSortValues(a, b, 'desc'))).toEqual([
      143800,
      98600,
      12800,
      null,
    ]);
  });

  it('no confunde precios grandes con texto', () => {
    // Comparados como texto, "9.000.000" sería mayor que "86.000.000".
    expect(compareSortValues(86000000, 9000000, 'asc')).toBeGreaterThan(0);
  });
});

describe('compareSortValues — texto', () => {
  it('ordena alfabéticamente', () => {
    const marcas = ['renault', 'chevrolet', 'mazda'];
    expect([...marcas].sort((a, b) => compareSortValues(a, b, 'asc'))).toEqual([
      'chevrolet',
      'mazda',
      'renault',
    ]);
  });

  it('compara los números dentro del texto como números', () => {
    const modelos = ['onix 10', 'onix 2', 'onix 1'];
    expect([...modelos].sort((a, b) => compareSortValues(a, b, 'asc'))).toEqual(
      ['onix 1', 'onix 2', 'onix 10']
    );
  });
});

describe('searchTerms', () => {
  it('parte en palabras y normaliza', () => {
    expect(searchTerms('  KIA   Bogotá ')).toEqual(['kia', 'bogota']);
  });

  it('una consulta vacía no deja términos', () => {
    expect(searchTerms('   ')).toEqual([]);
  });
});

describe('matchesSearch', () => {
  const kia = normalize('KIA SPORTAGE GT LINE 2024 LPT098 MANIZALES');

  it('encuentra por una palabra suelta', () => {
    expect(matchesSearch(kia, searchTerms('sportage'))).toBe(true);
  });

  it('encuentra sin escribir la tilde', () => {
    const bogota = normalize('MAZDA 3 ALLNEW 2012 KKV561 BOGOTÁ');
    expect(matchesSearch(bogota, searchTerms('bogota'))).toBe(true);
  });

  it('exige TODAS las palabras, no cualquiera', () => {
    expect(matchesSearch(kia, searchTerms('kia 2024'))).toBe(true);
    expect(matchesSearch(kia, searchTerms('kia 2019'))).toBe(false);
  });

  it('busca por placa', () => {
    expect(matchesSearch(kia, searchTerms('lpt098'))).toBe(true);
  });

  it('sin términos no filtra nada', () => {
    expect(matchesSearch(kia, searchTerms(''))).toBe(true);
  });
});
