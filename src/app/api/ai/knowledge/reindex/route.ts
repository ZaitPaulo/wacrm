import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { loadEmbeddingsKey } from '@/lib/ai/config'
import { ingestDocument } from '@/lib/ai/knowledge'
import { AiError } from '@/lib/ai/types'

/**
 * POST /api/ai/knowledge/reindex  (admin+)
 *
 * Re-chunk and re-embed every document in the account. The main use is
 * after adding an embeddings key: existing documents were stored
 * lexical-only, and this backfills their vectors so semantic search
 * turns on. Also recovers documents whose indexing failed earlier.
 */
export async function POST() {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')
    const limit = checkRateLimit(`ai-kb-reindex:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const { data: docs, error } = await supabase
      .from('ai_knowledge_documents')
      .select('id, content')
      .eq('account_id', accountId)
    if (error) {
      console.error('[ai/knowledge/reindex] fetch error:', error)
      return NextResponse.json(
        { error: 'Failed to load documents' },
        { status: 500 },
      )
    }

    const { key: embeddingsApiKey, corrupt, provider: embeddingsProvider } = await loadEmbeddingsKey(
      supabase,
      accountId,
    )
    // The whole point of Reindex is usually to backfill embeddings — so
    // if a key is configured but can't be decrypted, don't quietly do a
    // lexical-only pass and report success. Stop and tell the admin.
    if (corrupt) {
      return NextResponse.json(
        {
          success: false,
          reindexed: 0,
          error:
            'Your embeddings key could not be decrypted (check ENCRYPTION_KEY, then re-enter the key in Settings → AI Assistant). Nothing was reindexed.',
        },
        { status: 200 },
      )
    }

    // REANUDABLE, y no por elegancia: el nivel gratuito de Gemini corta
    // en 100 embeddings por minuto y este inventario tiene 140
    // documentos. Como `ingestDocument` borra los vectores antes de
    // rehacerlos, volver a pulsar el botón reprocesaba los 140 desde
    // cero y moría siempre en el mismo punto — el trabajo hecho se
    // perdía y la operación no convergía nunca. Saltando lo que ya está
    // embebido, pulsar otra vez termina lo que faltó.
    //
    // Para forzar un reembebido completo (cambio de proveedor, vectores
    // de otra dimensión) hay que vaciar los vectores primero:
    //   UPDATE ai_knowledge_chunks SET embedding = NULL WHERE account_id = ...
    const saltables = new Set<string>()
    if (embeddingsApiKey) {
      const [{ data: conChunks }, { data: sinVector }] = await Promise.all([
        supabase.from('ai_knowledge_chunks').select('document_id').eq('account_id', accountId),
        supabase
          .from('ai_knowledge_chunks')
          .select('document_id')
          .eq('account_id', accountId)
          .is('embedding', null),
      ])
      const pendientes = new Set((sinVector ?? []).map((r) => r.document_id as string))
      for (const row of conChunks ?? []) {
        const id = row.document_id as string
        // Un documento a medio embeber se rehace entero: sus trozos
        // tienen que salir todos del mismo modelo.
        if (!pendientes.has(id)) saltables.add(id)
      }
    }

    let reindexed = 0
    let skipped = 0
    for (const doc of docs ?? []) {
      if (saltables.has(doc.id)) {
        skipped += 1
        continue
      }
      try {
        await ingestDocument(supabase, accountId, { embeddingsApiKey, embeddingsProvider }, doc.id, doc.content)
        reindexed += 1
      } catch (err) {
        // One bad document (e.g. a mid-run embeddings rate-limit) should
        // not abort the whole batch.
        const message = err instanceof AiError ? err.message : String(err)
        console.error(`[ai/knowledge/reindex] doc ${doc.id} failed:`, message)
        return NextResponse.json(
          {
            success: false,
            reindexed,
            skipped,
            total: (docs ?? []).length,
            error:
              `Reindexed ${reindexed} (${skipped} ya estaban), then hit an error: ${message}` +
              '. Vuelve a pulsar Reindexar para continuar donde se quedó.',
          },
          { status: 200 },
        )
      }
    }

    return NextResponse.json({ success: true, reindexed, skipped })
  } catch (err) {
    return toErrorResponse(err)
  }
}
