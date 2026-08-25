import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { MapPin, Phone, Mail, Clock, MessageCircle } from 'lucide-react';
import type { ShowcaseAccount } from '@/lib/showcase/format';

// Footer del negocio (paleta Loramotors), compartido por la portada y las
// páginas de detalle. Solo muestra los datos cargados en Ajustes → Public
// showcase. Server component.
export async function StoreFooter({ account }: { account: ShowcaseAccount }) {
  const t = await getTranslations('Storefront');
  const displayName = account.public_name?.trim() || account.name;
  const waDigits = account.public_whatsapp?.replace(/\D/g, '') || null;

  // Fondo blanco y no el gris de antes: el logo del negocio llega con el
  // fondo blanco horneado —es un JPEG— y sobre gris se recortaba como un
  // rectángulo. Lo que sigue separando el pie del cuerpo de la página,
  // que es apenas más oscuro (#f7f9fb), es el borde superior.
  return (
    <footer className="mt-auto w-full border-t border-[#c5c6cd] bg-white text-[#191c1e]">
      <div className="mx-auto max-w-[1280px] px-6 py-12 lg:px-12">
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
          {/* Marca */}
          <div>
            {account.public_logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={account.public_logo_url}
                alt={displayName}
                className="h-10 w-auto"
              />
            ) : (
              // El nombre en texto es el SUPLENTE del logo, no su pie:
              // un logotipo ya lleva el nombre dentro, así que mostrar
              // los dos lo repetía. Mismo criterio que la cabecera
              // (`store-nav.tsx`), que siempre enseñó uno u otro.
              <p className="text-xl font-black uppercase tracking-tight text-black">
                {displayName}
              </p>
            )}
            {account.public_hours && (
              <p className="mt-3 flex items-start gap-2 text-sm text-[#44474d]">
                <Clock className="mt-0.5 size-4 shrink-0 text-[#75777e]" />
                {account.public_hours}
              </p>
            )}
          </div>

          {/* Contacto */}
          <div>
            <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-[#191c1e]">
              {t('contact')}
            </h4>
            <ul className="space-y-2.5 text-sm text-[#44474d]">
              {account.public_address && (
                <li className="flex items-start gap-2">
                  <MapPin className="mt-0.5 size-4 shrink-0 text-[#75777e]" />
                  <span>{account.public_address}</span>
                </li>
              )}
              {account.public_phone && (
                <li className="flex items-center gap-2">
                  <Phone className="size-4 shrink-0 text-[#75777e]" />
                  <a
                    href={`tel:${account.public_phone.replace(/\s+/g, '')}`}
                    className="hover:text-black"
                  >
                    {account.public_phone}
                  </a>
                </li>
              )}
              {waDigits && (
                <li className="flex items-center gap-2">
                  <MessageCircle className="size-4 shrink-0 text-[#75777e]" />
                  <a
                    href={`https://wa.me/${waDigits}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-black"
                  >
                    WhatsApp
                  </a>
                </li>
              )}
              {account.public_email && (
                <li className="flex items-center gap-2">
                  <Mail className="size-4 shrink-0 text-[#75777e]" />
                  <a href={`mailto:${account.public_email}`} className="hover:text-black">
                    {account.public_email}
                  </a>
                </li>
              )}
            </ul>
          </div>
        </div>

        <div className="mt-8 flex flex-col gap-2 border-t border-[#c5c6cd] pt-6 text-sm text-[#44474d] sm:flex-row sm:items-center sm:justify-between">
          <span>
            © {new Date().getFullYear()} {displayName}
          </span>
          <div className="flex items-center gap-4">
            <Link href="/privacidad" className="transition-colors hover:text-black">
              {t('privacy')}
            </Link>
            <Link href="/login" className="transition-colors hover:text-black">
              {t('administration')}
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
