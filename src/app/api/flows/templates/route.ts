import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getTranslations } from 'next-intl/server'
import { listFlowTemplates } from '@/lib/flows/templates'
import { templateLabel, type LabelResolver } from '@/lib/templates/labels'

/**
 * GET /api/flows/templates
 *
 * Returns the static template gallery (slug + name + description +
 * icon hint + node_count) so the New-flow dialog can render cards
 * without bundling the full template payloads client-side. Bodies
 * are fetched only on actual clone via POST /api/flows.
 *
 * Available to any signed-in user. Flows is in soft-GA.
 */
export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  // Labels come from the catalogue for the install's locale — the
  // template module carries seed content, not display text.
  const label = (await getTranslations('Flows.templates')) as LabelResolver
  // Shallow shape so the client gallery doesn't have to know about
  // the full node tree.
  const templates = listFlowTemplates().map((t) => ({
    slug: t.slug,
    name: templateLabel(label, t.slug, 'name'),
    description: templateLabel(label, t.slug, 'description'),
    icon: t.icon,
    trigger_type: t.trigger_type,
    node_count: t.nodes.length,
  }))
  return NextResponse.json({ templates })
}
