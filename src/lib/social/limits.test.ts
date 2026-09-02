import { describe, expect, it } from 'vitest';
import {
  countHashtags,
  isPublishableImageUrl,
  strictestLimits,
  validateCaption,
} from './limits';
import {
  CAPTION_MAX_CHARS,
  INSTAGRAM_LIMITS,
  MAX_HASHTAGS,
} from './instagram/limits';

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
    expect(validateCaption('Mazda 3 2019, $45.000.000', INSTAGRAM_LIMITS)).toBeNull();
  });

  it('acepta un texto justo en el límite', () => {
    expect(validateCaption('a'.repeat(CAPTION_MAX_CHARS), INSTAGRAM_LIMITS)).toBeNull();
  });

  it('rechaza un texto que pasa el límite', () => {
    expect(validateCaption('a'.repeat(CAPTION_MAX_CHARS + 1), INSTAGRAM_LIMITS)).toBe('too_long');
  });

  it('cuenta emojis como un carácter, igual que Meta', () => {
    // Un emoji fuera del plano básico ocupa 2 unidades UTF-16. Con
    // .length esto se pasaría del límite sin haberlo pasado de verdad.
    const caption = '🚗'.repeat(CAPTION_MAX_CHARS);
    expect(validateCaption(caption, INSTAGRAM_LIMITS)).toBeNull();
  });

  it('rechaza demasiadas etiquetas', () => {
    const caption = Array.from(
      { length: MAX_HASHTAGS + 1 },
      (_, i) => `#t${i}`
    ).join(' ');
    expect(validateCaption(caption, INSTAGRAM_LIMITS)).toBe('too_many_hashtags');
  });

  it('acepta justo el máximo de etiquetas', () => {
    const caption = Array.from(
      { length: MAX_HASHTAGS },
      (_, i) => `#t${i}`
    ).join(' ');
    expect(validateCaption(caption, INSTAGRAM_LIMITS)).toBeNull();
  });
});

describe('validateCaption con una red que no limita etiquetas', () => {
  // Facebook no pone un tope de etiquetas. Advertir por el de Instagram
  // impediría publicar en Facebook un texto perfectamente válido.
  const sinTope = { ...INSTAGRAM_LIMITS, maxHashtags: null };

  it('acepta muchas más etiquetas de las que admite Instagram', () => {
    const caption = Array.from(
      { length: MAX_HASHTAGS * 3 },
      (_, i) => `#t${i}`
    ).join(' ');
    expect(validateCaption(caption, sinTope)).toBeNull();
  });

  it('sigue midiendo el largo del texto', () => {
    expect(
      validateCaption('a'.repeat(CAPTION_MAX_CHARS + 1), sinTope)
    ).toBe('too_long');
  });
});

describe('strictestLimits', () => {
  const IG = { maxImages: 10, captionMaxChars: 2200, maxHashtags: 30 };
  const FB = { maxImages: 10, captionMaxChars: 63_206, maxHashtags: null };

  it('sin redes no hay límite que aplicar', () => {
    expect(strictestLimits([])).toBeNull();
  });

  it('con una sola red devuelve la suya, sin arrastrar la de otra', () => {
    // Es lo que permite escribir largo cuando solo queda pendiente
    // Facebook: el tope de Instagram ya no interviene.
    expect(strictestLimits([FB])).toEqual(FB);
  });

  it('se queda con el tope de caracteres más bajo', () => {
    expect(strictestLimits([FB, IG])!.captionMaxChars).toBe(2200);
  });

  it('basta con que UNA red limite las etiquetas para que el tope valga', () => {
    // Facebook no limita, Instagram sí. El texto es compartido, así que
    // tiene que respetar el de Instagram o el botón único no sirve.
    expect(strictestLimits([FB, IG])!.maxHashtags).toBe(30);
    expect(strictestLimits([IG, FB])!.maxHashtags).toBe(30);
  });

  it('deja null solo si NINGUNA red limita las etiquetas', () => {
    expect(strictestLimits([FB, { ...FB, maxImages: 8 }])!.maxHashtags).toBeNull();
  });

  it('se queda con el máximo de fotos más bajo', () => {
    expect(strictestLimits([IG, { ...FB, maxImages: 4 }])!.maxImages).toBe(4);
  });
});
