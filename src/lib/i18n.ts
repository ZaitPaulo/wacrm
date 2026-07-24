/**
 * Single source of truth for the locale catalog and the text helpers
 * the dictionaries are rendered through.
 *
 * Shaped after `src/lib/themes.ts` — catalog constants, a type guard,
 * and the metadata the settings picker needs — so the two user
 * preferences read the same way.
 *
 * Where this deliberately diverges from the theme system: theme is
 * persisted in localStorage and replayed by a boot script, because
 * nothing on the server can know which accent to paint. Locale *does*
 * have a server-side consumer — `src/app/layout.tsx` is a Server
 * Component and reads the cookie below — so the first HTML response
 * already carries the right language. There is no flash to prevent and
 * therefore no boot script, and the cookie is the only store. A second
 * copy in localStorage could silently disagree with it (say, once the
 * cookie expires) and buys nothing.
 *
 * Adding a locale is a three-step change:
 *   1. Append the id to `LOCALES` below and an entry to `LOCALE_META`.
 *   2. Add `src/lib/dictionaries/<id>.ts` typed as `Dictionary`.
 *   3. Register it in the `DICTIONARIES` map in `src/hooks/use-locale.tsx`.
 * Step 2 will not compile until every key is translated, which is the
 * point — see the note in `src/lib/dictionaries/es.ts`.
 */

export const LOCALES = ['es', 'en'] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'es';

/**
 * Read on the server via `cookies()` and written on the client by
 * `setLocale()`. Not prefixed `NEXT_` and not http-only — both sides
 * need it, and a UI language preference carries nothing sensitive.
 */
export const LOCALE_COOKIE = 'wacrm.locale';

/** One year. Long enough that the choice feels permanent. */
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function isLocale(value: unknown): value is Locale {
  return (
    typeof value === 'string' &&
    (LOCALES as ReadonlyArray<string>).includes(value)
  );
}

/**
 * The one resolution path, shared by the server layout and the client
 * provider so they cannot disagree about what a given cookie means.
 *
 * Anything unrecognised — absent, empty, truncated, or hand-edited to
 * `fr` — degrades to the default rather than throwing. A bad cookie
 * should render a Spanish page, never an error one.
 */
export function resolveLocale(value: unknown): Locale {
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

export interface LocaleMeta {
  id: Locale;
  /** The language's own name, as speakers of it write it. */
  name: string;
  /** Shown as a subtitle so the option is findable in either language. */
  englishName: string;
}

/** Order here drives the settings picker. */
export const LOCALE_META: ReadonlyArray<LocaleMeta> = [
  { id: 'es', name: 'Español', englishName: 'Spanish' },
  { id: 'en', name: 'English', englishName: 'English' },
];

export type InterpolationValues = Record<string, string | number>;

/**
 * Replaces `{name}` placeholders with caller-supplied values.
 *
 * An unmatched placeholder is left verbatim instead of being blanked:
 * a visible `{count}` in the UI points straight at the offending key,
 * whereas an empty string reads as a finished sentence and hides the
 * bug. Lookup goes through `hasOwnProperty` so inherited keys like
 * `constructor` cannot be pulled in from the prototype chain.
 */
export function interpolate(
  template: string,
  values?: InterpolationValues
): string {
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key)
      ? String(values[key])
      : match
  );
}

export interface PluralForms {
  one: string;
  other: string;
}

/**
 * Two-form pluralization, which is all Spanish and English need —
 * both have identical cardinality (one / other). This is the reason
 * the project carries no ICU MessageFormat dependency; see
 * `openspec/changes/add-i18n-es-en/design.md`, decision 3.
 *
 * A locale with different plural rules (Polish, Arabic, Russian) would
 * not fit here and is the point at which `Intl.PluralRules` — or a
 * library — starts earning its keep.
 *
 * `count` is always available to the chosen form, so the common case
 * reads `plural(n, { one: '{count} contacto', other: '{count} contactos' })`
 * with no second argument.
 */
export function plural(
  count: number,
  forms: PluralForms,
  values?: InterpolationValues
): string {
  const form = count === 1 ? forms.one : forms.other;
  return interpolate(form, { count, ...values });
}

/**
 * `Intl` constructors are comparatively expensive and these run inside
 * render paths (message timestamps, dashboard metrics), so formatters
 * are memoised per locale + options rather than rebuilt each call.
 */
const dateTimeFormatters = new Map<string, Intl.DateTimeFormat>();
const numberFormatters = new Map<string, Intl.NumberFormat>();
const relativeTimeFormatters = new Map<string, Intl.RelativeTimeFormat>();

function cacheKey(locale: Locale, options?: object): string {
  return options ? `${locale}:${JSON.stringify(options)}` : locale;
}

export function formatDate(
  value: Date | string | number,
  locale: Locale,
  options: Intl.DateTimeFormatOptions = { dateStyle: 'medium' }
): string {
  const key = cacheKey(locale, options);
  let formatter = dateTimeFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, options);
    dateTimeFormatters.set(key, formatter);
  }
  return formatter.format(toDate(value));
}

export function formatNumber(
  value: number,
  locale: Locale,
  options?: Intl.NumberFormatOptions
): string {
  const key = cacheKey(locale, options);
  let formatter = numberFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, options);
    numberFormatters.set(key, formatter);
  }
  return formatter.format(value);
}

/**
 * Largest-first, so a 90-minute gap reports as "hace 2 horas" rather
 * than "hace 90 minutos". `second` terminates the walk.
 */
const RELATIVE_UNITS: ReadonlyArray<[Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 60 * 60 * 24 * 365],
  ['month', 60 * 60 * 24 * 30],
  ['week', 60 * 60 * 24 * 7],
  ['day', 60 * 60 * 24],
  ['hour', 60 * 60],
  ['minute', 60],
  ['second', 1],
];

/**
 * Replaces the hand-rolled "x ago" strings, which were English-only by
 * construction. `numeric: 'auto'` is what produces "ayer" / "yesterday"
 * instead of the stiffer "hace 1 día" / "1 day ago".
 *
 * `now` is injectable so tests are not clock-dependent.
 */
export function formatRelativeTime(
  value: Date | string | number,
  locale: Locale,
  now: Date = new Date()
): string {
  const deltaSeconds = (toDate(value).getTime() - now.getTime()) / 1000;
  const magnitude = Math.abs(deltaSeconds);

  let formatter = relativeTimeFormatters.get(locale);
  if (!formatter) {
    formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
    relativeTimeFormatters.set(locale, formatter);
  }

  for (const [unit, secondsInUnit] of RELATIVE_UNITS) {
    if (magnitude >= secondsInUnit || unit === 'second') {
      return formatter.format(Math.round(deltaSeconds / secondsInUnit), unit);
    }
  }
  // Unreachable: the loop always terminates on 'second'.
  return formatter.format(0, 'second');
}

function toDate(value: Date | string | number): Date {
  return value instanceof Date ? value : new Date(value);
}

const weekdayLabels = new Map<Locale, ReadonlyArray<string>>();

/**
 * Short weekday names, Monday first, to match the `dow` indexing the
 * dashboard's response-time buckets use (0 = Monday … 6 = Sunday).
 *
 * Derived from `Intl` rather than a hardcoded array so the labels
 * follow the active locale. 2024-01-01 is a Monday, which anchors the
 * walk without needing any day-of-week arithmetic.
 */
export function shortWeekdaysMondayFirst(
  locale: Locale
): ReadonlyArray<string> {
  const cached = weekdayLabels.get(locale);
  if (cached) return cached;

  const formatter = new Intl.DateTimeFormat(locale, { weekday: 'short' });
  const labels = Array.from({ length: 7 }, (_, i) =>
    formatter.format(new Date(Date.UTC(2024, 0, 1 + i)))
  );
  weekdayLabels.set(locale, labels);
  return labels;
}
