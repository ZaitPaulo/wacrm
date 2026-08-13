import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { SETTINGS_SECTIONS } from '@/components/settings/settings-sections';

// Locale dictionaries are hand-maintained. English is the source of
// truth (src/i18n/request.ts falls back to en.json only when a whole
// locale file is missing — there is no per-key fallback), so a key
// that lands in en.json and not in a translation renders as a raw
// keypath for users on that locale. This guards the parity.

const MESSAGES_DIR = join(process.cwd(), 'messages');
const SOURCE_LOCALE = 'en';

// Discovered from disk rather than listed by hand: a hardcoded list
// silently stops covering a locale the moment someone adds one, which is
// exactly the gap this test exists to close.
const TRANSLATED_LOCALES = readdirSync(MESSAGES_DIR)
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.replace(/\.json$/, ''))
  .filter((locale) => locale !== SOURCE_LOCALE)
  .sort();

function loadKeys(locale: string): Set<string> {
  const raw = readFileSync(join(MESSAGES_DIR, `${locale}.json`), 'utf8');
  const out = new Set<string>();
  const walk = (node: unknown, path: string) => {
    if (node && typeof node === 'object' && !Array.isArray(node)) {
      for (const [k, v] of Object.entries(node)) {
        walk(v, path ? `${path}.${k}` : k);
      }
      return;
    }
    out.add(path);
  };
  walk(JSON.parse(raw), '');
  return out;
}

describe('message catalogue parity', () => {
  const source = loadKeys(SOURCE_LOCALE);

  it.each(TRANSLATED_LOCALES)('%s.json covers every en.json key', (locale) => {
    const translated = loadKeys(locale);
    const missing = [...source].filter((k) => !translated.has(k)).sort();
    expect(missing, `${locale}.json is missing these keys`).toEqual([]);
  });

  it.each(TRANSLATED_LOCALES)('%s.json has no orphaned keys', (locale) => {
    const translated = loadKeys(locale);
    const orphaned = [...translated].filter((k) => !source.has(k)).sort();
    expect(orphaned, `${locale}.json has keys absent from en.json`).toEqual([]);
  });
});

// Parity between locales says nothing about whether a key the CODE
// asks for exists at all: a label missing from every catalogue is
// perfectly "in parity" and renders as the raw keypath on screen.
//
// The settings rail is where that bit us. It labels each section with
// `Settings.sections.<id>`, and two ids shipped without one — `showcase`
// for a while, then `instagram`. Both showed up in the sidebar as
// "Settings.sections.showcase" to real users.
describe('settings rail labels', () => {
  const ALL_LOCALES = [SOURCE_LOCALE, ...TRANSLATED_LOCALES];

  it.each(ALL_LOCALES)('%s.json labels every settings section', (locale) => {
    const keys = loadKeys(locale);
    const missing = SETTINGS_SECTIONS.filter(
      (id) => !keys.has(`Settings.sections.${id}`)
    );
    expect(
      missing,
      `${locale}.json has no Settings.sections label for these sections`
    ).toEqual([]);
  });
});
