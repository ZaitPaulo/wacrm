import { describe, expect, it } from 'vitest';
import {
  CAPTION_MAX_CHARS,
  MAX_HASHTAGS,
  countHashtags,
  isPublishableImageUrl,
  validateCaption,
} from './limits';

describe('isPublishableImageUrl', () => {
  it('acepta JPEG en sus dos extensiones', () => {
    expect(isPublishableImageUrl('https://cdn.example.com/a.jpg')).toBe(true);
    expect(isPublishableImageUrl('https://cdn.example.com/a.jpeg')).toBe(true);
  });

  it('rechaza los formatos que el bucket permite pero Instagram no', () => {
    expect(isPublishableImageUrl('https://cdn.example.com/a.png')).toBe(false);
    expect(isPublishableImageUrl('https://cdn.example.com/a.webp')).toBe(false);
  });

  it('ignora la query string y las mayúsculas', () => {
    expect(isPublishableImageUrl('https://cdn.example.com/A.JPG?token=x')).toBe(
      true
    );
    expect(isPublishableImageUrl('https://cdn.example.com/a.png?v=2')).toBe(
      false
    );
  });
});

describe('countHashtags', () => {
  it('cuenta las etiquetas de un texto', () => {
    expect(countHashtags('Mazda 3 #usados #bogota #autos')).toBe(3);
  });

  it('no cuenta un # suelto', () => {
    expect(countHashtags('Precio # negociable')).toBe(0);
  });

  it('cuenta etiquetas con acentos y números', () => {
    expect(countHashtags('#camioneta4x4 #bogotá')).toBe(2);
  });
});

describe('validateCaption', () => {
  it('acepta un texto normal', () => {
    expect(validateCaption('Mazda 3 2019, $45.000.000')).toBeNull();
  });

  it('acepta un texto justo en el límite', () => {
    expect(validateCaption('a'.repeat(CAPTION_MAX_CHARS))).toBeNull();
  });

  it('rechaza un texto que pasa el límite', () => {
    expect(validateCaption('a'.repeat(CAPTION_MAX_CHARS + 1))).toBe('too_long');
  });

  it('cuenta emojis como un carácter, igual que Meta', () => {
    // Un emoji fuera del plano básico ocupa 2 unidades UTF-16. Con
    // .length esto se pasaría del límite sin haberlo pasado de verdad.
    const caption = '🚗'.repeat(CAPTION_MAX_CHARS);
    expect(validateCaption(caption)).toBeNull();
  });

  it('rechaza demasiadas etiquetas', () => {
    const caption = Array.from(
      { length: MAX_HASHTAGS + 1 },
      (_, i) => `#t${i}`
    ).join(' ');
    expect(validateCaption(caption)).toBe('too_many_hashtags');
  });

  it('acepta justo el máximo de etiquetas', () => {
    const caption = Array.from(
      { length: MAX_HASHTAGS },
      (_, i) => `#t${i}`
    ).join(' ');
    expect(validateCaption(caption)).toBeNull();
  });
});
