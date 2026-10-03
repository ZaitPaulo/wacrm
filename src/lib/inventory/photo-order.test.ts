import { describe, it, expect } from 'vitest';
import {
  makeCoverImage,
  photoCutoff,
  reorderImages,
  sortFilesByName,
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

describe('sortFilesByName', () => {
  // Sólo importa `name`: se prueba con objetos planos para no depender
  // de `File`, que en Node existe pero no hace falta.
  const names = (files: { name: string }[]) => files.map((f) => f.name);
  const asFiles = (list: string[]) => list.map((name) => ({ name }));

  it('devuelve la portada primero aunque el selector la entregue última', () => {
    // Lo que hace el diálogo de Windows al seleccionar con clic en la
    // primera y Mayús+clic en la última: la del foco viene adelante.
    const fromPicker = asFiles(['05.jpg', '01.jpg', '02.jpg', '03.jpg', '04.jpg']);
    expect(names(sortFilesByName(fromPicker))).toEqual([
      '01.jpg',
      '02.jpg',
      '03.jpg',
      '04.jpg',
      '05.jpg',
    ]);
  });

  it('ordena los números como números, igual que el explorador', () => {
    const fromPicker = asFiles(['foto 10.jpg', 'foto 2.jpg', 'foto 1.jpg']);
    expect(names(sortFilesByName(fromPicker))).toEqual([
      'foto 1.jpg',
      'foto 2.jpg',
      'foto 10.jpg',
    ]);
  });

  it('no distingue mayúsculas de minúsculas', () => {
    const fromPicker = asFiles(['b.JPG', 'A.jpg', 'c.jpg']);
    expect(names(sortFilesByName(fromPicker))).toEqual(['A.jpg', 'b.JPG', 'c.jpg']);
  });

  it('conserva el orden de llegada entre nombres equivalentes', () => {
    const first = { name: 'IMG.jpg', id: 1 };
    const second = { name: 'img.jpg', id: 2 };
    expect(sortFilesByName([first, second])).toEqual([first, second]);
  });

  it('no muta la lista original', () => {
    const fromPicker = asFiles(['b.jpg', 'a.jpg']);
    sortFilesByName(fromPicker);
    expect(names(fromPicker)).toEqual(['b.jpg', 'a.jpg']);
  });

  it('acepta una lista vacía', () => {
    expect(sortFilesByName([])).toEqual([]);
  });

  // Auditoría QA: los nombres que entregan cámaras y celulares.
  it('ceros a la izquierda: IMG_0009 antes que IMG_0010 y IMG_0100', () => {
    const fromPicker = asFiles(['IMG_0100.jpg', 'IMG_0010.jpg', 'IMG_0009.jpg']);
    expect(names(sortFilesByName(fromPicker))).toEqual([
      'IMG_0009.jpg',
      'IMG_0010.jpg',
      'IMG_0100.jpg',
    ]);
  });

  it('tildes y eñe: como en español, sin mandar las tildadas al final', () => {
    const fromPicker = asFiles(['oso.jpg', 'ñandú.jpg', 'Éxito.jpg', 'nube.jpg', 'zeta.jpg']);
    expect(names(sortFilesByName(fromPicker))).toEqual([
      'Éxito.jpg',
      'nube.jpg',
      'ñandú.jpg',
      'oso.jpg',
      'zeta.jpg',
    ]);
  });

  it('extensiones distintas no alteran el orden numérico', () => {
    const fromPicker = asFiles(['10.HEIC', '02.png', '3.jpeg', '1.jpg']);
    expect(names(sortFilesByName(fromPicker))).toEqual([
      '1.jpg',
      '02.png',
      '3.jpeg',
      '10.HEIC',
    ]);
  });

  // Auditoría QA: comparar el nombre entero mete la extensión en la
  // pelea, y como el espacio va antes que el punto, "foto (2).jpg"
  // quedaba antes que "foto.jpg" y la portada dejaba de ser la primera.
  it('el original sin sufijo va antes que sus copias "(2)", "(3)"', () => {
    const fromPicker = asFiles(['foto (3).jpg', 'foto.jpg', 'foto (2).jpg']);
    expect(names(sortFilesByName(fromPicker))).toEqual([
      'foto.jpg',
      'foto (2).jpg',
      'foto (3).jpg',
    ]);
  });

  it('descargas de WhatsApp Web: la base con puntos va antes que "(1)" y "(2)"', () => {
    const base = 'WhatsApp Image 2026-10-02 at 10.15.32 AM';
    const fromPicker = asFiles([`${base} (2).jpeg`, `${base}.jpeg`, `${base} (1).jpeg`]);
    expect(names(sortFilesByName(fromPicker))).toEqual([
      `${base}.jpeg`,
      `${base} (1).jpeg`,
      `${base} (2).jpeg`,
    ]);
  });

  it('misma base: desempata por extensión, y sin extensión va primero', () => {
    const fromPicker = asFiles(['foto.png', 'foto.jpg', 'foto']);
    expect(names(sortFilesByName(fromPicker))).toEqual(['foto', 'foto.jpg', 'foto.png']);
  });

  it('un nombre que empieza por punto se trata como base, no como extensión', () => {
    const fromPicker = asFiles(['b.jpg', '.jpg', 'a.jpg']);
    expect(names(sortFilesByName(fromPicker))).toEqual(['.jpg', 'a.jpg', 'b.jpg']);
  });

  it('no muta un FileList real (solo lectura, vía Array.from)', () => {
    const list = Object.freeze(asFiles(['b.jpg', 'a.jpg']));
    expect(names(sortFilesByName(list))).toEqual(['a.jpg', 'b.jpg']);
    expect(names([...list])).toEqual(['b.jpg', 'a.jpg']);
  });
});
