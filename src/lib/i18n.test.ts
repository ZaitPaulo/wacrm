import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LOCALE,
  LOCALES,
  LOCALE_META,
  formatDate,
  formatNumber,
  formatRelativeTime,
  interpolate,
  isLocale,
  plural,
  resolveLocale,
} from './i18n';

describe('isLocale', () => {
  it('accepts exactly the supported locales', () => {
    expect(isLocale('es')).toBe(true);
    expect(isLocale('en')).toBe(true);
  });

  it('rejects nullish values', () => {
    expect(isLocale(null)).toBe(false);
    expect(isLocale(undefined)).toBe(false);
  });

  it('rejects unsupported and malformed strings', () => {
    for (const bad of ['fr', '', 'ES', 'es-MX', 'english', ' es']) {
      expect(isLocale(bad)).toBe(false);
    }
  });

  it('rejects non-string types', () => {
    for (const bad of [0, 1, true, {}, [], ['es']]) {
      expect(isLocale(bad)).toBe(false);
    }
  });
});

describe('resolveLocale', () => {
  it('passes through a valid cookie value', () => {
    expect(resolveLocale('en')).toBe('en');
    expect(resolveLocale('es')).toBe('es');
  });

  it('falls back to Spanish for a missing cookie', () => {
    expect(resolveLocale(undefined)).toBe('es');
    expect(resolveLocale(null)).toBe('es');
  });

  it('falls back to Spanish for empty or malformed values', () => {
    // A hand-edited or truncated cookie must render a Spanish page,
    // never an error one.
    for (const bad of ['', 'fr', 'ES', 'es-MX', '{}', 'null']) {
      expect(resolveLocale(bad)).toBe(DEFAULT_LOCALE);
    }
  });

  it('never throws, whatever it is handed', () => {
    for (const bad of [0, {}, [], true, Symbol('es')]) {
      expect(() => resolveLocale(bad)).not.toThrow();
    }
  });
});

describe('interpolate', () => {
  it('substitutes a named placeholder', () => {
    expect(interpolate('Hola {name}', { name: 'Ana' })).toBe('Hola Ana');
  });

  it('replaces every occurrence of a repeated placeholder', () => {
    expect(interpolate('{n} de {n}', { n: 3 })).toBe('3 de 3');
  });

  it('leaves a placeholder with no supplied value untouched', () => {
    // Visible braces point at the offending key; blanking it would
    // read as a finished sentence and hide the bug.
    expect(interpolate('Hola {name}', { other: 'x' })).toBe('Hola {name}');
    expect(interpolate('Hola {name}')).toBe('Hola {name}');
  });

  it('coerces numeric values to strings', () => {
    expect(interpolate('{count} items', { count: 0 })).toBe('0 items');
  });

  it('does not pull values from the prototype chain', () => {
    expect(interpolate('{constructor}', {})).toBe('{constructor}');
    expect(interpolate('{toString}', {})).toBe('{toString}');
  });

  it('returns the template unchanged when it has no placeholders', () => {
    expect(interpolate('Sin variables', { a: 1 })).toBe('Sin variables');
  });
});

describe('plural', () => {
  const forms = { one: '{count} contacto', other: '{count} contactos' };

  it('selects the singular form only at exactly one', () => {
    expect(plural(1, forms)).toBe('1 contacto');
  });

  it('selects the plural form at zero', () => {
    expect(plural(0, forms)).toBe('0 contactos');
  });

  it('selects the plural form above one', () => {
    expect(plural(2, forms)).toBe('2 contactos');
    expect(plural(57, forms)).toBe('57 contactos');
  });

  it('interpolates the count without the caller passing it', () => {
    expect(plural(4, { one: 'uno', other: 'son {count}' })).toBe('son 4');
  });

  it('merges extra values alongside the count', () => {
    expect(
      plural(2, { one: '{count} en {list}', other: '{count} en {list}' }, {
        list: 'Ventas',
      })
    ).toBe('2 en Ventas');
  });

  it('works for English forms too', () => {
    const en = { one: '{count} contact', other: '{count} contacts' };
    expect(plural(1, en)).toBe('1 contact');
    expect(plural(3, en)).toBe('3 contacts');
  });
});

describe('locale catalog', () => {
  it('describes every supported locale exactly once', () => {
    expect(LOCALE_META.map((m) => m.id).sort()).toEqual([...LOCALES].sort());
  });

  it('defaults to Spanish', () => {
    expect(DEFAULT_LOCALE).toBe('es');
  });
});

describe('formatNumber', () => {
  it('uses different separators per locale', () => {
    // es-ES groups with '.' and decimals with ','; en does the reverse.
    expect(formatNumber(1234.5, 'es')).not.toBe(formatNumber(1234.5, 'en'));
  });

  it('formats English with a comma group separator', () => {
    expect(formatNumber(1234, 'en')).toBe('1,234');
  });

  it('returns a stable result across repeated calls (formatter cache)', () => {
    expect(formatNumber(1234, 'es')).toBe(formatNumber(1234, 'es'));
  });
});

describe('formatDate', () => {
  const date = new Date('2026-03-14T12:00:00Z');

  it('renders the same instant differently per locale', () => {
    expect(formatDate(date, 'es')).not.toBe(formatDate(date, 'en'));
  });

  it('accepts a timestamp and an ISO string as well as a Date', () => {
    expect(formatDate(date.getTime(), 'en')).toBe(formatDate(date, 'en'));
    expect(formatDate(date.toISOString(), 'en')).toBe(formatDate(date, 'en'));
  });
});

describe('formatRelativeTime', () => {
  const now = new Date('2026-03-14T12:00:00Z');

  it('translates past offsets', () => {
    const twoHoursAgo = new Date('2026-03-14T10:00:00Z');
    expect(formatRelativeTime(twoHoursAgo, 'es', now)).toBe('hace 2 horas');
    expect(formatRelativeTime(twoHoursAgo, 'en', now)).toBe('2 hours ago');
  });

  it('picks the largest sensible unit rather than the smallest', () => {
    // 90 minutes reads as hours, not "hace 90 minutos".
    const ninetyMinutesAgo = new Date('2026-03-14T10:30:00Z');
    expect(formatRelativeTime(ninetyMinutesAgo, 'es', now)).toContain('hora');
  });

  it('uses the natural wording for a one-day offset', () => {
    // `numeric: 'auto'` is what buys "ayer" over "hace 1 día".
    const yesterday = new Date('2026-03-13T12:00:00Z');
    expect(formatRelativeTime(yesterday, 'es', now)).toBe('ayer');
    expect(formatRelativeTime(yesterday, 'en', now)).toBe('yesterday');
  });

  it('handles future offsets', () => {
    const inThreeDays = new Date('2026-03-17T12:00:00Z');
    expect(formatRelativeTime(inThreeDays, 'en', now)).toBe('in 3 days');
  });

  it('reports sub-minute gaps in seconds without throwing', () => {
    const justNow = new Date('2026-03-14T11:59:50Z');
    expect(() => formatRelativeTime(justNow, 'es', now)).not.toThrow();
  });
});
