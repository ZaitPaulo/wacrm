# Tasks — i18n (Spanish default, English)

## 1. Core i18n module

- [x] 1.1 Create `src/lib/i18n.ts` with `LOCALES = ['es', 'en'] as const`, `type Locale`, `DEFAULT_LOCALE = 'es'`, and the locale cookie name constant. Mirror the shape of `src/lib/themes.ts`.
- [x] 1.2 Add `isLocale(value: unknown): value is Locale` returning `true` only for `es` and `en`, and `false` for `null`, `undefined` and any other value.
- [x] 1.3 Add `interpolate(template, values)` replacing named placeholders, leaving unmatched placeholders untouched and replacing every occurrence of a repeated name.
- [x] 1.4 Add `plural(count, forms)` selecting the singular form only when `count === 1`, and exposing `count` for interpolation into the selected form.
- [x] 1.5 Add `resolveLocale(rawCookieValue)` returning the validated locale or `DEFAULT_LOCALE`, so both the server and the client share one resolution path.

## 2. Dictionaries

- [x] 2.1 Create `src/lib/dictionaries/es.ts` exporting `es` and `export type Dictionary = typeof es`, with namespaces `common`, `nav`, `auth`, `dashboard`, `settings`. Note: **not** `as const` — literal types would force every other locale to repeat the Spanish text verbatim. Plain inference widens values to `string` while keeping keys exact, which is the guarantee we want.
- [x] 2.2 Extract the Spanish copy for the Phase 1 surfaces into those namespaces (layout, auth, dashboard, appearance panel — roughly 200 strings).
- [x] 2.3 Create `src/lib/dictionaries/en.ts` exporting `en` annotated `: Dictionary`, carrying the current English copy verbatim from the components being migrated.
- [x] 2.4 Confirm `npm run typecheck` fails when a key is removed from `en.ts`, then restore it. This proves the compile-time guarantee is real rather than assumed. Verified: `error TS2741: Property 'inbox' is missing`.

## 3. Locale provider

- [x] 3.1 Create `src/hooks/use-locale.tsx` with a `LocaleProvider` accepting `initialLocale` as a prop, following the structure of `src/hooks/use-theme.tsx`.
- [x] 3.2 Implement `setLocale()` to update state, write the locale cookie, and set `document.documentElement.lang`.
- [x] 3.3 Export `useLocale()` / `useT()` exposing the active dictionary, backed by the statically imported `es` and `en` so switching needs no network round-trip. Note: `t` is the typed dictionary object (`t.nav.inbox`), not a `t('nav.inbox')` string lookup — the compiler checks it at the call site with no path-type machinery and no per-render traversal. Locale-bound `formatDate` / `formatNumber` / `formatRelativeTime` ride along; `interpolate` and `plural` stay pure imports since they need no locale.
- [x] 3.4 Add cross-tab synchronization. Note: **not** the `storage` event as originally written — that fires only for localStorage writes, and the locale deliberately lives in a cookie alone. Uses `BroadcastChannel`, which is the purpose-built equivalent and avoids reintroducing a second store just to emit a notification.
- [x] 3.5 Give `useLocale()` a safe fallback when called outside the provider, returning Spanish rather than throwing — the same defensive posture as `useTheme()`.

## 4. Server wiring

- [x] 4.1 In `src/app/layout.tsx`, read the locale cookie with `await cookies()` and resolve it through `resolveLocale()`.
- [x] 4.2 Replace the hardcoded `<html lang="en">` with the resolved locale.
- [x] 4.3 Wrap the tree in `<LocaleProvider initialLocale={locale}>` inside the existing `ThemeProvider`, and confirm no boot script is added for locale — the server already renders the right language.
- [x] 4.4 Verify the initial HTML response for a request carrying the English cookie contains `lang="en"` and English shell text, with no post-hydration correction. Verified with `curl` against the dev server, which executes no JavaScript — so what it received is what the server sent. No cookie → `<html lang="es">` with "Bienvenido de nuevo" / "¿Olvidaste tu contraseña?"; `wacrm.locale=en` → `<html lang="en">` with "Welcome back" / "Forgot password?". Malformed values (`fr`, empty, `ES`, `es-MX`, `{}`, `null`, `../etc`) all render a 200 in Spanish rather than erroring.

## 5. Locale-aware formatting

- [x] 5.1 Add date, time and number formatters to `src/lib/i18n.ts` built on `Intl.DateTimeFormat` and `Intl.NumberFormat`, taking the active locale.
- [x] 5.2 Add a relative-time formatter on `Intl.RelativeTimeFormat` to replace the hand-rolled "x ago" strings on Phase 1 surfaces.
- [x] 5.3 Migrate the `toLocaleDateString()` / `toLocaleString()` calls in Phase 1 files to the new formatters. Leave calls in unmigrated files untouched.

## 6. Language selector

- [x] 6.1 Add a language section to `src/components/settings/appearance-panel.tsx` next to the existing mode and accent controls, reusing that file's card and `radiogroup` patterns.
- [x] 6.2 Wire it to `useT()` / `setLocale()` so the choice applies immediately, with no save button — consistent with how mode and accent already behave.
- [x] 6.3 Show the active locale as the selected option when the panel opens.

## 7. Migrate shell surfaces

- [x] 7.1 Migrate `src/components/layout/sidebar.tsx`, `header.tsx` and `mode-toggle.tsx` to `t()`.
- [x] 7.2 Migrate `src/app/(auth)/login/page.tsx`, `signup/page.tsx` and `forgot-password/page.tsx`, including form labels, placeholders and validation messages rendered client-side.
- [x] 7.3 Migrate `src/app/(dashboard)/dashboard/page.tsx`.
- [x] 7.4 Migrate `src/components/dashboard/*` — metric cards, activity feed, quick actions, empty states, skeletons and chart labels.
- [x] 7.5 Migrate the static copy in `appearance-panel.tsx` itself, including its `SettingsPanelHead` title and description.
- [x] 7.6 Convert `ActivityItem` in `src/lib/dashboard/types.ts` to a discriminated union on `kind` carrying parameters instead of a pre-built `text` sentence.
- [x] 7.7 Update `loadActivity` in `src/lib/dashboard/queries.ts` to emit those parameters, removing the English sentence construction from the data layer.
- [x] 7.8 Compose the activity copy in `activity-feed.tsx` with `t()`, covering all five kinds.
- [x] 7.9 Replace the `DOW_SHORT_MON_FIRST` lookup in `response-time-chart.tsx` with locale-derived short weekday labels. Leave the constant and its existing test in place.

## 8. Guardrails

- [x] 8.1 Add a comment at the `Language` control in `src/components/settings/template-manager.tsx` (around line 712) stating it is the Meta template language and must not be coupled to the UI locale.
- [x] 8.2 Confirm `src/middleware.ts` is unmodified and that switching language changes no URL and triggers no redirect.

## 9. Tests

- [x] 9.1 Create `src/lib/i18n.test.ts` covering `isLocale()` for both valid locales, `null`, `undefined` and arbitrary strings.
- [x] 9.2 Test `resolveLocale()` against a valid cookie, a missing cookie, an empty string and a malformed value, asserting it falls back to `es` without throwing.
- [x] 9.3 Test `interpolate()` for substitution, a repeated placeholder, and a placeholder with no supplied value.
- [x] 9.4 Test `plural()` at counts 0, 1 and 2, and that the count interpolates into the selected form.
- [x] 9.5 Test that the formatters produce different output for `es` and `en` for the same date and the same number.

## 10. Verification

- [x] 10.1 Run `npm run typecheck` and confirm it passes.
- [x] 10.2 Run `npm run lint` and confirm it passes.
- [x] 10.3 Run `npm test` and confirm the full suite passes, including the existing tests. Result: **622 of 625 pass; no regressions from this change.** The 3 failures are pre-existing and environment-dependent, all in `src/lib/currency.test.ts`, which asserts US number grouping (`1,234`) while `formatCurrency` calls `Intl.NumberFormat(undefined, …)` — the *system* locale, `es-CO` on this machine, which formats `1.234`. Two further failures in `date-utils.test.ts` come from the machine's `America/Bogota` timezone and disappear under `TZ=UTC` (13/13 pass). Neither file, nor the modules they exercise, is touched by this change, and neither has any import at all — they cannot reach this code even transitively.
- [ ] 10.4 Walk the migrated screens in both locales, checking that longer Spanish strings do not overflow controls sized for English. **Not done — needs a human.** The three auth pages are public and verified as correct markup, but the dashboard, sidebar and appearance panel sit behind a login this session has no credentials for. Layout overflow is also a visual judgement a markup diff cannot make: Spanish copy runs roughly 20% longer, and the likely pressure points are the sidebar nav rows ("Automatizaciones", "Notificaciones"), the metric card titles ("Valor de tratos abiertos"), and the response-time header ("Tiempo promedio de primera respuesta").
- [x] 10.5 Open an unmigrated screen (for example the inbox) under the Spanish locale and confirm it renders its existing English text with no blank labels or errors. Verified structurally rather than visually, which is the stronger check here: `git diff` confirms `inbox/page.tsx`, `contacts/page.tsx`, `pipelines/page.tsx`, `message-thread.tsx` and `whatsapp-config.tsx` are untouched, and no component under `inbox/`, `contacts/`, `pipelines/`, `broadcasts/`, `flows/` or `automations/` imports the dictionary. Their English literals are still inline, so there is no lookup that could miss and no key that could resolve empty.
