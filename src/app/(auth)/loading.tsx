// Skeleton para las pantallas de autenticación (login / registro /
// recuperar contraseña).
export default function Loading() {
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-4">
        <div className="bg-muted mx-auto h-10 w-32 animate-pulse rounded" />
        <div className="border-border space-y-3 rounded-lg border p-6">
          <div className="bg-muted h-4 w-24 animate-pulse rounded" />
          <div className="bg-muted h-10 w-full animate-pulse rounded" />
          <div className="bg-muted h-4 w-24 animate-pulse rounded" />
          <div className="bg-muted h-10 w-full animate-pulse rounded" />
          <div className="bg-muted h-10 w-full animate-pulse rounded" />
        </div>
      </div>
    </div>
  );
}
