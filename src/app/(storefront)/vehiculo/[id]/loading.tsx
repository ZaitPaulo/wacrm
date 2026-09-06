// UI de carga instantánea para /vehiculo/[id]. Next la muestra como
// fallback de Suspense mientras el server component resuelve los datos,
// así el click desde la vitrina da feedback inmediato.
export default function Loading() {
  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-6xl px-4 py-6">
        <div className="h-4 w-32 animate-pulse rounded bg-slate-200" />
      </div>

      <main className="mx-auto max-w-6xl px-4 pb-14">
        <div className="grid gap-8 lg:grid-cols-2">
          {/* Galería */}
          <div className="space-y-3">
            <div className="aspect-[4/3] w-full animate-pulse rounded-2xl bg-slate-200" />
            <div className="flex gap-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="size-16 animate-pulse rounded-lg bg-slate-200" />
              ))}
            </div>
          </div>

          {/* Info */}
          <div className="space-y-6">
            <div className="h-8 w-2/3 animate-pulse rounded bg-slate-200" />
            <div className="h-9 w-40 animate-pulse rounded bg-slate-200" />
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="h-16 animate-pulse rounded-lg bg-slate-200" />
              ))}
            </div>
            <div className="h-12 w-full animate-pulse rounded-xl bg-slate-200 sm:w-64" />
          </div>
        </div>
      </main>
    </div>
  )
}
