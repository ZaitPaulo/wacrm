// Skeleton de la vitrina/portada (fallback de Suspense en navegación).
// Cubre la raíz y cualquier ruta sin un loading más cercano.
export default function Loading() {
  return (
    <div className="min-h-screen bg-slate-50">
      {/* Hero */}
      <div className="bg-gradient-to-br from-slate-900 to-slate-700">
        <div className="mx-auto max-w-6xl space-y-4 px-4 py-16">
          <div className="h-4 w-40 animate-pulse rounded bg-white/20" />
          <div className="h-10 w-2/3 animate-pulse rounded bg-white/20" />
          <div className="h-4 w-1/2 animate-pulse rounded bg-white/10" />
        </div>
      </div>

      {/* Grilla */}
      <div className="mx-auto max-w-6xl px-4 py-12">
        <div className="mb-6 h-6 w-48 animate-pulse rounded bg-slate-200" />
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200/70"
            >
              <div className="aspect-[4/3] animate-pulse bg-slate-200" />
              <div className="space-y-3 p-5">
                <div className="h-5 w-2/3 animate-pulse rounded bg-slate-200" />
                <div className="h-6 w-1/3 animate-pulse rounded bg-slate-200" />
                <div className="grid grid-cols-3 gap-2">
                  {Array.from({ length: 3 }).map((_, j) => (
                    <div key={j} className="h-12 animate-pulse rounded-lg bg-slate-100" />
                  ))}
                </div>
                <div className="h-10 w-full animate-pulse rounded-xl bg-slate-200" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
