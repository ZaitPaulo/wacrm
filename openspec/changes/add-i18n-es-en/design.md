# Design — i18n (Spanish default, English)

## Context

The UI is hardcoded in English: ~1,252 unique user-facing strings across 168 files (120 UI files, 48 API routes). There is no translation layer of any kind.

Three properties of this codebase shaped every decision below, and each contradicts the advice you would get by default:

1. **102 of 122 `.tsx` files are `'use client'`.** The pattern in `node_modules/next/dist/docs/01-app/02-guides/internationalization.md` puts `getDictionary()` in Server Components so the dictionary never reaches the browser. With this client/server split that benefit largely evaporates — the strings ship to the client either way.

2. **The app is `noindex`.** `src/app/layout.tsx` sets `robots: { index: false, follow: false }`; wacrm is a CRM behind authentication. The main argument for `/es/…` path-prefix routing — per-locale indexable URLs — does not apply here.

3. **A near-identical problem is already solved in-repo.** `src/hooks/use-theme.tsx` plus the boot script in `src/app/layout.tsx` handle "user preference applied before hydration, no flash, synced across tabs" for theme and mode. Following that shape keeps the preference system recognizable instead of introducing a second, unrelated one.

Strings are also concentrated, which makes phasing viable: `whatsapp-config.tsx` (82), `automation-builder.tsx` (79), `node-config-form.tsx` (61) and `template-manager.tsx` (55) hold 22% of the total, and none are in Phase 1.

## Goals / Non-Goals

**Goals:**

- Spanish as the default locale, English selectable, switchable at runtime with no reload.
- Translation infrastructure that a later phase can extend to any screen without redesign.
- Missing translations caught by `npm run typecheck`, not discovered as blank text in production.
- No change to URLs, routing, `src/middleware.ts`, the database schema, or any API contract.
- Unmigrated screens keep working, untouched, in English.

**Non-Goals:**

- Translating API route error strings (~174). See Decision 7.
- Retranslating `notifications` rows. See Risks.
- Any third locale. `LOCALES` is an array, so adding one is mechanical, but nothing here is built speculatively for it.
- Locale-prefixed URLs, locale negotiation from `Accept-Language`, or per-account (as opposed to per-device) language.

## Decisions

### 1. Cookie as the single source of truth — not localStorage, not a URL prefix

The locale lives in one cookie, readable by the server via `await cookies()` in `src/app/layout.tsx` and by the client via `document.cookie`.

*Why not a URL prefix (`/es/…`), which the Next docs present as canonical?* It would require moving all of `app/` under `app/[lang]/` and reworking `src/middleware.ts`, whose auth logic matches on literal pathnames (`/login`, `/dashboard`, and the `protectedPaths` list). That is a large, risky diff whose payoff is SEO — and this app is `noindex`.

*Why not localStorage, mirroring `use-theme`?* This is where we deliberately diverge from the theme precedent, and the reason is worth stating: theme needs localStorage plus a boot script precisely because it has **no server-side consumer** — only the browser can know which accent to paint, so the server cannot render it and a boot script must patch `<html>` before first paint. Locale **does** have a server-side consumer: the root layout is a Server Component and can read the cookie, so the server emits `<html lang="es">` and Spanish text in the initial response. There is no flash to prevent, so there is no boot script to write. Adding localStorage on top would create two stores that can silently disagree — for instance after the cookie expires — with no benefit.

*Consequence:* the preference is per-device, matching how theme already behaves and what the appearance panel already tells the user ("Saved to this device").

### 2. Dictionaries as `.ts` modules, with Spanish defining the type

```
src/lib/dictionaries/es.ts   →  export const es = { … }          // NOT `as const`
                                export type Dictionary = typeof es
src/lib/dictionaries/en.ts   →  export const en: Dictionary = { … }
```

Because `en` is annotated as `Dictionary`, TypeScript rejects it if a key is missing or extra. A translation gap becomes a failing `npm run typecheck`, not a blank label someone notices in production weeks later. Verified rather than assumed: deleting one key from `en.ts` produces `error TS2741: Property 'inbox' is missing`. JSON files cannot give this, which is the whole reason for choosing `.ts` over the `.json` the Next docs use.

The missing `as const` is load-bearing. It looks like an oversight, so it is worth stating: `as const` would infer literal types (`'Panel'` rather than `string`), and `en` would then have to repeat the Spanish text verbatim to satisfy the type. Plain inference widens values to `string` while keeping the key structure exact — which is the half we want enforced.

Accessing text is `t.nav.inbox` — the dictionary object itself, not a `t('nav.inbox')` lookup. The compiler checks it at the call site with no template-literal path types and no per-render traversal, and rename refactors reach into components.

Keys are namespaced by module (`common`, `nav`, `auth`, `dashboard`, `settings`), so each later phase maps to adding one namespace.

### 3. Hand-rolled, zero new dependencies — not `next-intl`

`next-intl`'s two headline features are ICU MessageFormat and locale routing. We have no use for routing (Decision 1), and we do not need ICU: **Spanish and English have identical plural cardinality** (one / other), so the ~40 conditional-plural sites in the codebase are covered by a two-form helper. Interpolation is a `String.replace`. Dates and numbers go through the platform's `Intl`, which the project already uses (`Intl.NumberFormat`, 5 sites).

That leaves a new dependency, its configuration surface, and a mode of that library we would be using against its grain — in exchange for features we do not need. The helpers it would replace are roughly 40 lines and fully unit-tested.

Revisit this if a third locale with different plural rules (Polish, Arabic, Russian) is ever added; that is the point at which ICU earns its keep.

### 4. Both dictionaries ship to the client

`use-locale.tsx` imports `es` and `en` statically, so `setLocale()` is a synchronous state change: instant switch, no network round-trip, no loading state, no flash.

The cost is ~15-20 KB gzipped for both dictionaries once Phase 1 through N are complete. For an authenticated internal CRM already shipping Recharts, `@xyflow/react` and `@dnd-kit`, this is not the bundle's problem. If it ever becomes one, the fix is a dynamic `import()` per locale, at the price of a brief flash on switch — a change local to the provider.

### 5. Static prerendering is traded away — measured, not assumed

*Corrected during implementation. An earlier draft of this document asserted that "every page behind this layout is authenticated and already renders per-request." That was wrong, and the build output disproves it.*

Reading the cookie in the root layout opts every route out of static prerendering. Measured against `HEAD`: **16 of 72 routes were statically prerendered before this change, and none are after** — `/login`, `/signup`, `/forgot-password`, `/dashboard`, `/inbox`, `/contacts`, `/pipelines`, `/broadcasts`, `/automations`, `/agents`, `/flows`, `/notifications`, `/settings`, `/automations/new`, `/broadcasts/new`, and `/_not-found`.

That sounds worse than it is, and the reason is `src/middleware.ts`. Its matcher excludes only `_next/static`, `_next/image`, `favicon.ico` and image files, so it runs on all 16 — and it `await`s `supabase.auth.getUser()`, a network round-trip, before any response goes out. **None of those routes was ever actually served at static speed.** The prerender saved a shell render; the request still blocked on an auth call. What this change adds on top of that is one server-component render of a shell, which is marginal next to a round-trip that was already there.

The 13 authenticated routes then fetch their data client-side anyway, so their prerendered HTML was a skeleton regardless.

The alternative was to keep the layout static and let the client correct the language after hydration — which reintroduces exactly the flash of wrong language this design exists to avoid, and would emit `<html lang="es">` for English users until hydration. Rejected on those grounds, not on performance ones.

Worth revisiting if the middleware is ever narrowed to skip the public auth pages; at that point those three would become genuinely static-serveable and the trade would look different.

### 6. Provider seeded from the server

`layout.tsx` (Server Component) resolves the locale from the cookie and passes it to `<LocaleProvider initialLocale={…}>` as a prop. The provider's initial state therefore matches what the server rendered, so there is no hydration mismatch and `suppressHydrationWarning` is not needed for `lang` — unlike the theme attributes, which genuinely do mismatch by design.

`useT()` returns a `t` function bound to the active locale. Components call `t('nav.inbox')`. Cross-tab sync uses the same `storage`-event approach as `use-theme`, with the event carrying a lightweight signal rather than the locale being stored there.

### 7. API route strings are out of scope, by design

The ~174 error strings in `src/app/api/**` mostly surface as toasts. Translating them server-side would require the API to know the caller's locale and would bake presentation into the transport. The correct fix is for routes to return a stable machine-readable `code` that the UI maps to translated copy — a refactor with its own risk profile, touching 48 files and every consumer. Mixing it into this change would double the diff and blur what is being verified.

### 8. The activity feed carries data, not sentences

*Added during implementation — the audit that produced this design counted strings in components and missed this one.*

`src/lib/dashboard/queries.ts` builds the activity feed's copy as finished English sentences inside the data layer (`New message from ${who}`, `Deal "${title}" in ${stage}`), and `ActivityItem.text` carries the result. There is no key to translate — by the time the component sees it, it is prose.

This is the same mistake as the notifications trigger, one layer up, and the same principle Decision 6 states for API routes: the data layer should emit facts, the view layer should phrase them. So `ActivityItem` becomes a discriminated union on `kind` carrying the parameters (`who`, `dealTitle`, `stageName`, `recipients`, …), and `activity-feed.tsx` composes the sentence with `t()`.

Scope is contained: 4 consumers, all inside the dashboard, and `loadActivity` has no tests to rewrite. The alternative — leaving the feed in English — was rejected because the dashboard is Phase 1's flagship surface, and a Spanish page with an English feed down the middle reads as a bug rather than as staged delivery.

Weekday labels get the same treatment for the same reason: `DOW_SHORT_MON_FIRST` is a hardcoded English array, replaced at the chart's call site by `Intl.DateTimeFormat(locale, { weekday: 'short' })`. The old constant stays where it is — it still backs its own passing test — rather than being refactored out as unrelated cleanup.

### 9. Phasing

Phase 1 covers infrastructure plus the shell: layout (sidebar, header, mode toggle), auth pages, dashboard, and the appearance panel — roughly 200 strings across ~15 files. Later phases each take one namespace: settings, inbox, contacts, pipelines, broadcasts, automations, flows.

This works because unmigrated files are simply not edited: their literals stay where they are and keep rendering in English under either locale. There is no half-migrated state that renders blank.

## Risks / Trade-offs

- **Existing English-speaking users see Spanish after deploy** → The default flips for anyone without a cookie. Mitigated by the selector being one click away in a panel users already visit for theme. Deliberate: Spanish-first is the point of the change.

- **`notifications.title` / `.body` are frozen English in the database** → Written by the `notify_conversation_assigned()` trigger in `supabase/migrations/027_notifications.sql` at insert time. Switching language cannot retranslate existing rows, and new rows stay English until a later phase stores a type plus parameters and renders client-side. Documented as a known limitation rather than half-fixed here.

- **Someone couples the Meta template `Language` field to the UI locale** → `src/components/settings/template-manager.tsx` has a `Language` control that means "language of the message registered with Meta". The names collide and the mistake would push wrong data to Meta. Mitigated by a comment at that site; the spec also asserts the two stay independent.

- **Phase 1 ships a visibly bilingual app** → Migrated shell in Spanish, unmigrated screens in English. Accepted: the alternative is a single 168-file, 1,252-string pull request that cannot be meaningfully reviewed.

- **Translation quality is not compiler-checkable** → Types guarantee a key exists, not that its Spanish is correct or that it fits the layout. Longer Spanish strings can overflow controls sized for English. Mitigated by reviewing Phase 1 surfaces in both locales before merge.

- **Cookie unavailable or blocked** → Resolution falls back to `es` and the UI still renders; the choice simply does not persist. `isLocale()` guards every read, so a corrupted value degrades to the default rather than throwing.

## Migration Plan

1. Land `lib/i18n.ts`, the dictionaries, `use-locale.tsx` and their tests — additive, nothing behaves differently yet.
2. Wire `layout.tsx` to resolve the cookie and seed the provider; `<html lang>` becomes dynamic.
3. Add the selector to `appearance-panel.tsx`, so the locale can be exercised before any screen depends on it.
4. Migrate shell surfaces one directory at a time: layout, auth, dashboard.
5. Verify `npm run typecheck`, `npm run lint` and `npm test` pass, then walk the migrated screens in both locales.

**Rollback:** every step is additive or confined to the touched file. Reverting the commit restores English throughout; no database migration, no schema change, and no persisted state beyond a cookie that is ignored once `isLocale()` is gone.

## Open Questions

None. The two decisions that were genuinely open — cookie-only persistence over cookie-plus-localStorage, and shipping both dictionaries over code-splitting them — were raised explicitly and confirmed before this document was written.
