# Add i18n support (Spanish default, English)

## Why

The entire UI is hardcoded in English — roughly 1,252 unique user-facing strings across 168 files, with no translation layer of any kind. wacrm is a self-hostable CRM aimed at WhatsApp-first businesses, and WhatsApp Business is heavily used across Latin America and Spain, so an English-only interface is a hard adoption barrier for a large part of the target market.

We need Spanish as the default language with English available, and a way for users to switch. This change introduces the translation infrastructure and migrates the application shell; remaining screens follow in later phases.

## What Changes

- **BREAKING (user-visible)**: the default UI language becomes Spanish. Existing users see a Spanish shell on first load after deploy until they pick English. No data or API contract changes.
- New `src/lib/i18n.ts` — supported locales, default locale, cookie name, `isLocale()` type guard, and the `interpolate()` / `plural()` helpers.
- New typed dictionaries at `src/lib/dictionaries/es.ts` and `en.ts`. `es.ts` is the source of truth and defines the `Dictionary` type; `en.ts` is declared as that type so a missing or extra key fails `npm run typecheck` rather than rendering blank text at runtime.
- New `src/hooks/use-locale.tsx` — a `LocaleProvider` plus a `useT()` hook, mirroring the existing `use-theme.tsx` provider so the codebase keeps one recognizable shape for user preferences.
- `src/app/layout.tsx` reads the locale cookie server-side and renders the correct `<html lang>`, then seeds the provider. No boot script and no flash of the wrong language.
- A language selector added to `src/components/settings/appearance-panel.tsx`, alongside the existing theme and mode controls.
- Shell surfaces translated: layout (sidebar, header, mode toggle), auth pages (login, signup, forgot-password), the dashboard page and its components, and the appearance panel itself.
- Dates, times and numbers in migrated surfaces format through native `Intl` APIs driven by the active locale, replacing bare `toLocaleDateString()` / `toLocaleString()` calls and the hand-rolled "x ago" strings.

Explicitly **not** in this change:

- API route error strings (~174). Translating them server-side is the wrong fix; the correct approach is returning stable machine-readable codes that the UI maps to translated copy. That is its own refactor.
- The `notifications` table. Its `title` / `body` are written in English by a Postgres trigger and frozen in the row at insert time, so switching language cannot retranslate past notifications. Fixing this requires storing a type plus parameters and rendering client-side.
- The WhatsApp template `Language` field. It denotes the language of the message registered with Meta and must stay decoupled from the UI language.

## Capabilities

### New Capabilities

- `i18n`: Locale selection, persistence and resolution; dictionary lookup with interpolation and pluralization; locale-aware date, time and number formatting; and the language selector UI.

### Modified Capabilities

None. No existing spec's requirements change.

## Impact

**New files**
- `src/lib/i18n.ts`, `src/lib/i18n.test.ts`
- `src/lib/dictionaries/es.ts`, `src/lib/dictionaries/en.ts`
- `src/hooks/use-locale.tsx`

**Modified files (~15)**
- `src/app/layout.tsx` — server-side cookie read, dynamic `<html lang>`, provider wiring
- `src/components/layout/` — `sidebar.tsx`, `header.tsx`, `mode-toggle.tsx`
- `src/app/(auth)/` — `login`, `signup`, `forgot-password` pages
- `src/app/(dashboard)/dashboard/page.tsx` and `src/components/dashboard/*`
- `src/components/settings/appearance-panel.tsx` — hosts the new selector
- `src/components/settings/template-manager.tsx` — comment only, warning that the Meta template `Language` field is not the UI language

**Dependencies**: none added. Formatting uses the platform's built-in `Intl`, which the project already relies on via `Intl.NumberFormat`.

**Bundle**: both dictionaries ship to the client (~15-20 KB gzipped combined) so switching language is instant with no refetch. Deliberate tradeoff for an authenticated internal app.

**Not affected**: `src/middleware.ts` (URLs are unchanged — locale lives in a cookie, not a path prefix), the database schema, and all API contracts.
