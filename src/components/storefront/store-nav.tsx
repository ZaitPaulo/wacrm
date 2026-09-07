import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { ShowcaseAccount } from '@/lib/showcase/format';

// Nav sticky de la vitrina (estilo Loramotors), compartida por la portada
// y las páginas de detalle. Server component.
export async function StoreNav({ account }: { account: ShowcaseAccount }) {
  const t = await getTranslations('Storefront');
  const displayName = account.public_name?.trim() || account.name;

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
              <span className="text-2xl font-extrabold uppercase tracking-tighter text-black font-[family-name:var(--font-barlow-condensed)]">
                {displayName}
              </span>
            )}
          </Link>
          <nav className="hidden items-center gap-6 md:flex">
            <Link
              href="/#inventario"
              className="border-b-2 border-black pb-1 text-xs font-semibold uppercase tracking-wide text-black hover:border-(--brand) hover:text-(--brand) transition-colors font-[family-name:var(--font-barlow-condensed)]"
            >
              {t('inventory')}
            </Link>
          </nav>
        </div>
      </div>
    </header>
  );
}
