import Link from 'next/link';
import type { ShowcaseAccount } from '@/lib/showcase/format';

// Nav sticky de la vitrina (estilo Loramotors), compartida por la portada
// y las páginas de detalle. Server component.
export function StoreNav({ account }: { account: ShowcaseAccount }) {
  const displayName = account.public_name?.trim() || account.name;
  const waDigits = account.public_whatsapp?.replace(/\D/g, '') || null;

  return (
    <header className="sticky top-0 z-50 w-full border-b border-[#c5c6cd]/60 bg-white/90 backdrop-blur-md">
      <div className="mx-auto flex max-w-[1280px] items-center justify-between px-6 py-4 lg:px-12">
        <div className="flex items-center gap-8">
          <Link href="/" className="flex items-center gap-2">
            {account.public_logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={account.public_logo_url}
                alt={displayName}
                className="h-8 w-auto object-contain"
              />
            ) : (
              <span className="text-2xl font-extrabold uppercase tracking-tighter text-black">
                {displayName}
              </span>
            )}
          </Link>
          <nav className="hidden items-center gap-6 md:flex">
            <Link
              href="/#inventario"
              className="border-b-2 border-black pb-1 text-xs font-semibold uppercase tracking-wide text-black"
            >
              Inventario
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-4">
          {waDigits && (
            <a
              href={`https://wa.me/${waDigits}`}
              target="_blank"
              rel="noopener noreferrer"
              className="hidden text-xs font-semibold uppercase tracking-wide text-[#44474d] transition-colors hover:text-black md:block"
            >
              Contacto
            </a>
          )}
          <Link
            href="/login"
            className="rounded-lg bg-[#0059bb] px-6 py-2.5 text-xs font-semibold uppercase tracking-wide text-white transition-colors hover:bg-[#0070ea]"
          >
            Iniciar sesión
          </Link>
        </div>
      </div>
    </header>
  );
}
