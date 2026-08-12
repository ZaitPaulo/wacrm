/**
 * Gallery labels for the seed templates.
 *
 * A template has two halves with different owners. Its *content* — the
 * messages sent to the customer — is seed data: copied verbatim on
 * clone, after which the operator owns and edits it, so it must never
 * be re-resolved from the catalogue. Its *name and description* are
 * interface text: they describe the template to whoever is browsing
 * the gallery, and belong in the catalogue like any other label.
 *
 * This resolves the second half, in one place, because five call sites
 * need it: two galleries, two clone endpoints and the new-automation
 * page — half of them on the server, where the locale comes from the
 * install's `NEXT_PUBLIC_APP_LOCALE` rather than from a request.
 *
 * A template with no entry in the active catalogue falls back to its
 * slug rather than rendering next-intl's raw keypath. Adding a template
 * and forgetting one language should look unpolished, not broken.
 */

/**
 * The shape both `useTranslations()` and `getTranslations()` satisfy.
 * Declared structurally so this module stays usable from client and
 * server without importing either.
 */
export interface LabelResolver {
  (key: string): string
  has(key: string): boolean
}

export function templateLabel(
  t: LabelResolver,
  slug: string,
  field: 'name' | 'description',
): string {
  const key = `${slug}.${field}`
  if (t.has(key)) return t(key)
  // Name falls back to the slug so the card is still identifiable;
  // a missing description is simply absent rather than filler.
  return field === 'name' ? slug : ''
}
