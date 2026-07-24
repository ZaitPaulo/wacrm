import Link from 'next/link';
import { MapPin, Phone, Mail, Clock, MessageCircle } from 'lucide-react';
import type { ShowcaseAccount } from '@/lib/showcase/format';

// Footer del negocio, compartido por la portada y las páginas de detalle.
// Solo muestra los datos que el negocio haya cargado (Ajustes → Public
// showcase). Server component.
export function StoreFooter({ account }: { account: ShowcaseAccount }) {
  const displayName = account.public_name?.trim() || account.name;
  const waDigits = account.public_whatsapp?.replace(/\D/g, '') || null;

  return (
    <footer className="border-t border-slate-200 bg-white">
      <div className="mx-auto max-w-6xl px-4 py-10">
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
          {/* Marca */}
          <div>
            {account.public_logo_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={account.public_logo_url}
                alt={displayName}
                className="mb-3 h-10 w-auto"
              />
            )}
            <p className="text-lg font-bold text-slate-900">{displayName}</p>
            {account.public_hours && (
              <p className="mt-3 flex items-start gap-2 text-sm text-slate-500">
                <Clock className="mt-0.5 size-4 shrink-0 text-slate-400" />
                {account.public_hours}
              </p>
            )}
          </div>

          {/* Contacto */}
          <div>
            <h4 className="mb-3 text-sm font-semibold text-slate-900">Contacto</h4>
            <ul className="space-y-2.5 text-sm text-slate-600">
              {account.public_address && (
                <li className="flex items-start gap-2">
                  <MapPin className="mt-0.5 size-4 shrink-0 text-slate-400" />
                  <span>{account.public_address}</span>
                </li>
              )}
              {account.public_phone && (
                <li className="flex items-center gap-2">
                  <Phone className="size-4 shrink-0 text-slate-400" />
                  <a
                    href={`tel:${account.public_phone.replace(/\s+/g, '')}`}
                    className="hover:text-slate-900"
                  >
                    {account.public_phone}
                  </a>
                </li>
              )}
              {waDigits && (
                <li className="flex items-center gap-2">
                  <MessageCircle className="size-4 shrink-0 text-slate-400" />
                  <a
                    href={`https://wa.me/${waDigits}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-slate-900"
                  >
                    WhatsApp
                  </a>
                </li>
              )}
              {account.public_email && (
                <li className="flex items-center gap-2">
                  <Mail className="size-4 shrink-0 text-slate-400" />
                  <a
                    href={`mailto:${account.public_email}`}
                    className="hover:text-slate-900"
                  >
                    {account.public_email}
                  </a>
                </li>
              )}
            </ul>
          </div>
        </div>

        <div className="mt-8 flex flex-col gap-2 border-t border-slate-200 pt-6 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between">
          <span>
            © {new Date().getFullYear()} {displayName}
          </span>
          <Link href="/login" className="transition hover:text-slate-900">
            Administración
          </Link>
        </div>
      </div>
    </footer>
  );
}
