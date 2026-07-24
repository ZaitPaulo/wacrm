'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { en } from '@/lib/dictionaries/en';
import { es, type Dictionary } from '@/lib/dictionaries/es';
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  LOCALE_COOKIE_MAX_AGE,
  formatDate,
  formatNumber,
  formatRelativeTime,
  type Locale,
} from '@/lib/i18n';

/**
 * LocaleProvider — wraps the app and owns the active UI language.
 *
 * Unlike `ThemeProvider`, this one is *seeded from the server*:
 * `src/app/layout.tsx` reads the locale cookie during render and hands
 * the result down as `initialLocale`. State therefore starts out
 * matching the server-rendered HTML, so there is no hydration mismatch
 * and no boot script — the theme system needs both only because the
 * server cannot know which accent to paint.
 *
 * Both dictionaries are imported statically so switching language is a
 * synchronous state update: no fetch, no suspense, no flash. The cost
 * is that both ship to the client; for an authenticated CRM that is the
 * right trade (see design.md, decision 4).
 */

interface LocaleContextValue {
  locale: Locale;
  setLocale: (next: Locale) => void;
  /**
   * The dictionary itself, not a `t('some.key')` lookup function.
   *
   * `t.nav.inbox` is checked by the compiler at the call site with no
   * string-path machinery: a typo fails the build, rename refactors
   * work, and autocomplete lists the real keys. A string-key API would
   * need template-literal path types to reach the same safety, and
   * would still cost a runtime traversal per render.
   *
   * For dynamic text, pass these strings through `interpolate()` or
   * `plural()` from `@/lib/i18n` — both are pure and locale-independent,
   * so they are imported directly rather than handed out here.
   */
  t: Dictionary;
  /** Formatters pre-bound to the active locale, so no call site can pass the wrong one. */
  formatDate: (
    value: Date | string | number,
    options?: Intl.DateTimeFormatOptions
  ) => string;
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string;
  formatRelativeTime: (value: Date | string | number) => string;
}

const DICTIONARIES: Record<Locale, Dictionary> = { es, en };

const LocaleContext = createContext<LocaleContextValue | null>(null);

/**
 * Cross-tab sync. The theme provider listens for `storage` events, but
 * that only fires for localStorage writes and the locale deliberately
 * lives in a cookie alone — cookie writes emit no event at all. A
 * BroadcastChannel is the purpose-built equivalent, and keeps us from
 * reintroducing a second store just to get a notification out of it.
 */
const LOCALE_CHANNEL = 'wacrm.locale';

function writeLocaleCookie(locale: Locale) {
  // `SameSite=Lax` keeps the cookie on top-level navigations (which is
  // how the server reads it) while staying off cross-site requests.
  // `Secure` only when the page is already on https, so local http
  // development still persists the choice.
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie =
    `${LOCALE_COOKIE}=${locale}; path=/; max-age=${LOCALE_COOKIE_MAX_AGE}` +
    `; SameSite=Lax${secure}`;
}

export function LocaleProvider({
  initialLocale = DEFAULT_LOCALE,
  children,
}: {
  initialLocale?: Locale;
  children: ReactNode;
}) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    if (typeof document !== 'undefined') {
      document.documentElement.lang = next;
      writeLocaleCookie(next);
      try {
        new BroadcastChannel(LOCALE_CHANNEL).postMessage(next);
      } catch {
        // BroadcastChannel is unavailable in a few sandboxed contexts.
        // Losing cross-tab sync is cosmetic — this tab is still correct
        // and other tabs pick the choice up on their next navigation.
      }
    }
  }, []);

  // Change the language in tab A, tab B follows without a refresh.
  useEffect(() => {
    let channel: BroadcastChannel;
    try {
      channel = new BroadcastChannel(LOCALE_CHANNEL);
    } catch {
      return;
    }
    channel.onmessage = (event: MessageEvent<Locale>) => {
      // Trust is not an issue here (same-origin only), but the value
      // still round-trips through the same guard as every other read.
      setLocaleState((current) =>
        event.data !== current && event.data in DICTIONARIES
          ? event.data
          : current
      );
      document.documentElement.lang = event.data;
    };
    return () => channel.close();
  }, []);

  const value = useMemo<LocaleContextValue>(
    () => ({
      locale,
      setLocale,
      t: DICTIONARIES[locale],
      formatDate: (v, options) => formatDate(v, locale, options),
      formatNumber: (v, options) => formatNumber(v, locale, options),
      formatRelativeTime: (v) => formatRelativeTime(v, locale),
    }),
    [locale, setLocale]
  );

  return (
    <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
  );
}

/**
 * Falls back to the default locale rather than throwing when used
 * outside the provider — same defensive posture as `useTheme()`. A
 * component rendered off-tree should show Spanish text, not crash the
 * page.
 */
export function useLocale(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  if (!ctx) {
    return {
      locale: DEFAULT_LOCALE,
      setLocale: () => {},
      t: DICTIONARIES[DEFAULT_LOCALE],
      formatDate: (v, options) => formatDate(v, DEFAULT_LOCALE, options),
      formatNumber: (v, options) => formatNumber(v, DEFAULT_LOCALE, options),
      formatRelativeTime: (v) => formatRelativeTime(v, DEFAULT_LOCALE),
    };
  }
  return ctx;
}

/** Shorthand for the common case of only needing the strings. */
export function useT(): Dictionary {
  return useLocale().t;
}
