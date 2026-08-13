import { describe, expect, it } from 'vitest';

import {
  isDistinctiveName,
  normalizeName,
  suggestIdentityLinks,
  type SuggestionCandidate,
} from './identity-suggestions';

describe('normalizeName', () => {
  it('ignora acentos, mayúsculas y espacios de más', () => {
    expect(normalizeName('José  Pérez ')).toBe('jose perez');
    expect(normalizeName('JOSE PEREZ')).toBe('jose perez');
  });

  it('deja igual un nombre ya normal', () => {
    expect(normalizeName('ana gomez')).toBe('ana gomez');
  });
});

describe('isDistinctiveName', () => {
  it('un nombre de pila solo no alcanza', () => {
    // Hay muchas Anas. Sugerir por eso llena la lista de falsos y
    // termina en que nadie la mira.
    expect(isDistinctiveName('ana')).toBe(false);
  });

  it('nombre y apellido sí', () => {
    expect(isDistinctiveName('ana gomez')).toBe(true);
  });
});

const wa = (id: string, name: string | null): SuggestionCandidate => ({
  contactId: id,
  name,
  channels: ['whatsapp'],
});

const ig = (id: string, name: string | null): SuggestionCandidate => ({
  contactId: id,
  name,
  channels: ['instagram'],
});

describe('suggestIdentityLinks', () => {
  it('propone dos fichas de canales distintos con el mismo nombre', () => {
    const out = suggestIdentityLinks([
      wa('c1', 'José Pérez'),
      ig('c2', 'jose perez'),
    ]);

    expect(out).toHaveLength(1);
    expect(out[0].contactIds).toEqual(['c1', 'c2']);
    expect(out[0].reason).toBe('same_name');
    expect(out[0].matchedOn).toBe('jose perez');
  });

  it('NO propone dos fichas del mismo canal', () => {
    // Dos contactos de WhatsApp con el mismo nombre son dos personas:
    // si fueran la misma, la deduplicación por teléfono ya las habría
    // unido.
    const out = suggestIdentityLinks([
      wa('c1', 'José Pérez'),
      wa('c2', 'Jose Perez'),
    ]);

    expect(out).toHaveLength(0);
  });

  it('no propone por un nombre de pila suelto', () => {
    const out = suggestIdentityLinks([wa('c1', 'Ana'), ig('c2', 'ana')]);
    expect(out).toHaveLength(0);
  });

  it('ignora fichas sin nombre', () => {
    const out = suggestIdentityLinks([wa('c1', null), ig('c2', null)]);
    expect(out).toHaveLength(0);
  });

  it('ignora una ficha que ya está absorbida por otra', () => {
    const out = suggestIdentityLinks([
      wa('c1', 'José Pérez'),
      { ...ig('c2', 'Jose Perez'), mergedInto: 'c9' },
    ]);

    expect(out).toHaveLength(0);
  });

  it('no propone nada cuando los nombres difieren', () => {
    const out = suggestIdentityLinks([
      wa('c1', 'José Pérez'),
      ig('c2', 'Maria Lopez'),
    ]);
    expect(out).toHaveLength(0);
  });

  it('propone los tres pares cuando hay tres canales', () => {
    const out = suggestIdentityLinks([
      wa('c1', 'José Pérez'),
      ig('c2', 'José Pérez'),
      { contactId: 'c3', name: 'José Pérez', channels: ['messenger'] },
    ]);

    // c1-c2, c1-c3, c2-c3: quien revisa decide cuáles unir.
    expect(out).toHaveLength(3);
  });

  it('una ficha con identidad en dos canales no se propone contra ninguno de ellos', () => {
    const out = suggestIdentityLinks([
      {
        contactId: 'c1',
        name: 'José Pérez',
        channels: ['whatsapp', 'instagram'],
      },
      ig('c2', 'José Pérez'),
    ]);

    expect(out).toHaveLength(0);
  });
});
