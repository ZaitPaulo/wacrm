// Skeleton genérico del CRM. Como está a nivel del route group
// (dashboard), el layout (sidebar) se mantiene y este skeleton llena el
// área de contenido de cualquier ruta del panel que aún esté cargando.
export default function Loading() {
  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div className="bg-muted h-7 w-44 animate-pulse rounded" />
        <div className="bg-muted h-9 w-32 animate-pulse rounded" />
      </div>

      <div className="border-border rounded-md border">
        <div className="border-border border-b p-3">
          <div className="bg-muted h-5 w-full animate-pulse rounded" />
        </div>
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="border-border flex items-center gap-4 border-b p-3 last:border-b-0"
          >
            <div className="bg-muted h-4 flex-1 animate-pulse rounded" />
            <div className="bg-muted h-4 w-20 animate-pulse rounded" />
            <div className="bg-muted h-4 w-24 animate-pulse rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}
