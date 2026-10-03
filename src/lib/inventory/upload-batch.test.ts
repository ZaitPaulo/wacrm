import { describe, it, expect, vi, type Mock } from 'vitest';
import {
  uploadPhotoBatch,
  type UploadBatchDeps,
} from '@/lib/inventory/upload-batch';

type FakeFile = { name: string; size: number };

const file = (name: string, size = 100): FakeFile => ({ name, size });
const MAX = 1000;

/** Comprime sin tocar el tamaño y sube devolviendo una URL con el nombre. */
function deps(
  overrides: {
    compress?: Mock<(f: FakeFile) => Promise<FakeFile>>;
    upload?: Mock<(f: FakeFile) => Promise<string>>;
  } = {}
): UploadBatchDeps<FakeFile, FakeFile> & {
  compress: Mock<(f: FakeFile) => Promise<FakeFile>>;
  upload: Mock<(f: FakeFile) => Promise<string>>;
} {
  return {
    compress: vi.fn(async (f: FakeFile) => f),
    upload: vi.fn(async (f: FakeFile) => `https://cdn/${f.name}`),
    maxBytes: MAX,
    ...overrides,
  };
}

describe('uploadPhotoBatch', () => {
  it('sube todas en orden por nombre, no en el orden de llegada', async () => {
    const d = deps();
    const result = await uploadPhotoBatch(
      [file('10.jpg'), file('01.jpg'), file('02.jpg')],
      d
    );
    expect(result.urls).toEqual([
      'https://cdn/01.jpg',
      'https://cdn/02.jpg',
      'https://cdn/10.jpg',
    ]);
    expect(result.failed).toEqual([]);
    expect(d.upload.mock.calls.map(([f]) => f.name)).toEqual([
      '01.jpg',
      '02.jpg',
      '10.jpg',
    ]);
  });

  it('un fallo a mitad de la tanda conserva las anteriores y sigue con las siguientes', async () => {
    const boom = new Error('bucket caído');
    const d = deps({
      upload: vi.fn(async (f: FakeFile) => {
        if (f.name === 'b.jpg') throw boom;
        return `https://cdn/${f.name}`;
      }),
    });
    const result = await uploadPhotoBatch(
      [file('c.jpg'), file('a.jpg'), file('b.jpg')],
      d
    );
    expect(result.urls).toEqual(['https://cdn/a.jpg', 'https://cdn/c.jpg']);
    expect(result.failed).toEqual([
      { name: 'b.jpg', reason: 'error', error: boom },
    ]);
  });

  it('si la compresión lanza, esa foto falla y las demás siguen', async () => {
    const d = deps({
      compress: vi.fn(async (f: FakeFile) => {
        if (f.name === 'a.jpg') throw new Error('formato raro');
        return f;
      }),
    });
    const result = await uploadPhotoBatch([file('a.jpg'), file('b.jpg')], d);
    expect(result.urls).toEqual(['https://cdn/b.jpg']);
    expect(result.failed.map((f) => [f.name, f.reason])).toEqual([
      ['a.jpg', 'error'],
    ]);
  });

  it('la que sigue demasiado grande después de comprimir se omite sin subirla', async () => {
    const d = deps();
    const result = await uploadPhotoBatch(
      [file('a.jpg'), file('b.jpg', MAX + 1), file('c.jpg')],
      d
    );
    expect(result.urls).toEqual(['https://cdn/a.jpg', 'https://cdn/c.jpg']);
    expect(result.failed).toEqual([{ name: 'b.jpg', reason: 'tooLarge' }]);
    expect(d.upload.mock.calls.map(([f]) => f.name)).toEqual(['a.jpg', 'c.jpg']);
  });

  it('justo en el tope todavía entra', async () => {
    const result = await uploadPhotoBatch([file('a.jpg', MAX)], deps());
    expect(result.urls).toEqual(['https://cdn/a.jpg']);
  });

  it('si todas fallan, no hay URLs y cada una aparece como fallida, en orden', async () => {
    const d = deps({
      upload: vi.fn(async () => {
        throw new Error('sin red');
      }),
    });
    const result = await uploadPhotoBatch([file('b.jpg'), file('a.jpg')], d);
    expect(result.urls).toEqual([]);
    expect(result.failed.map((f) => f.name)).toEqual(['a.jpg', 'b.jpg']);
  });

  it('sin archivos: nada que subir', async () => {
    const d = deps();
    expect(await uploadPhotoBatch([], d)).toEqual({ urls: [], failed: [] });
    expect(d.compress).not.toHaveBeenCalled();
  });
});
