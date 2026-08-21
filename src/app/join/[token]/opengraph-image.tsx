import { ImageResponse } from 'next/og'
import { headers } from 'next/headers'
import { getLocale, getTranslations } from 'next-intl/server'

import { peekInvitation } from '@/lib/auth/peek-invitation'
import { APP_NAME } from '@/lib/brand'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'

export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

// `alt` tiene que ser un export estático (Next lo lee sin ejecutar el
// módulo), así que no puede salir del catálogo de traducciones. Queda en
// el idioma del despliegue, igual que los `alt` de las OG de la vitrina.
export const alt = 'Invitación para unirte al equipo'

// ============================================================
// Infografía del enlace de invitación.
//
// Es lo que ve quien recibe un /join/<token> por WhatsApp antes de
// abrirlo. Sin esta imagen el crawler caía en la OG genérica heredada de
// la raíz y la tarjeta salía con el título del producto y nada más.
//
// Dinámica de verdad: nombra la cuenta que invita, el rol y hasta cuándo
// sirve el enlace. Prerenderizarla no tendría sentido — hay una imagen
// distinta por token.
// ============================================================
export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ token: string }> }

const BRAND = '#7c3aed'

/**
 * IP del cliente igual que en /api/invitations/[token]/peek: la entrada
 * más a la izquierda de `x-forwarded-for` es el cliente original.
 */
function getClientIp(h: Headers): string {
  const xff = h.get('x-forwarded-for')
  if (xff) return xff.split(',')[0].trim()
  return h.get('x-real-ip')?.trim() || 'unknown'
}

export default async function OgImage({ params }: Params) {
  const [{ token }, locale, t, roles, h] = await Promise.all([
    params,
    getLocale(),
    getTranslations('JoinPage'),
    getTranslations('Settings.roles'),
    headers(),
  ])

  // Un brute-forcer que iterara tokens contra esta ruta esquivaría el
  // límite del endpoint de peek. Al pasarse del cupo no devolvemos 429
  // —un crawler solo mostraría el enlace roto— sino la tarjeta genérica,
  // que no consulta la base.
  const limit = checkRateLimit(`invite-og:${getClientIp(h)}`, RATE_LIMITS.invitationPreview)
  const invite = limit.success ? await peekInvitation(token) : null

  // Satori exige `display: flex` en todo div con más de un hijo, y cada
  // interpolación dentro de un elemento cuenta como un nodo de texto
  // aparte. Las frases se arman acá para que cada nodo tenga un hijo.
  //
  // Con invitación válida el titular es el nombre de la cuenta (corto y
  // contundente); si no se pudo leer, cae a una frase completa.
  const headline = invite ? invite.accountName : t('ogInvitedGeneric')
  const roleChip = invite ? t('ogRole', { role: roles(invite.role) }) : null
  const expiryChip = invite ? t('ogValidUntil', { date: formatDate(invite.expiresAt, locale) }) : null

  // El titular lo escribe un admin (nombre de cuenta) o es una frase
  // entera, así que su largo varía muchísimo. Satori no reajusta texto
  // que no cabe: sin bajar el cuerpo, un nombre largo se sale del
  // lienzo. Dos saltos alcanzan para todo lo que cabe en `accounts.name`.
  const headlineSize = headline.length > 34 ? 52 : headline.length > 18 ? 66 : 88

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: 72,
          background: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 55%, #2e1065 100%)',
          color: 'white',
          fontFamily: 'sans-serif',
        }}
      >
        {/* Membrete: el mismo cuadrado violeta con el glifo de chat que
            usan el favicon (app/icon.tsx) y el logo del sidebar. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 64,
              height: 64,
              borderRadius: 16,
              background: BRAND,
            }}
          >
            <svg
              width="36"
              height="36"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#ffffff"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          </div>
          <div style={{ fontSize: 36, fontWeight: 700, letterSpacing: -0.5 }}>{APP_NAME}</div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div
            style={{
              display: 'flex',
              fontSize: 28,
              color: '#c4b5fd',
              textTransform: 'uppercase',
              letterSpacing: 5,
            }}
          >
            {t('ogEyebrow')}
          </div>
          <div
            style={{
              display: 'flex',
              fontSize: headlineSize,
              fontWeight: 800,
              marginTop: 20,
              lineHeight: 1.1,
            }}
          >
            {headline}
          </div>

          {roleChip && expiryChip ? (
            <div style={{ display: 'flex', gap: 16, marginTop: 34 }}>
              <div style={chipStyle}>{roleChip}</div>
              <div style={chipStyle}>{expiryChip}</div>
            </div>
          ) : null}
        </div>

        <div style={{ display: 'flex', fontSize: 30, opacity: 0.7 }}>{t('ogFooter')}</div>
      </div>
    ),
    { ...size },
  )
}

const chipStyle = {
  display: 'flex',
  fontSize: 28,
  padding: '14px 26px',
  borderRadius: 999,
  background: 'rgba(255,255,255,0.10)',
  border: '1px solid rgba(255,255,255,0.22)',
} as const

/**
 * Fecha de vencimiento en el idioma del despliegue. Si el timestamp
 * viniera corrupto devuelve la cadena cruda en vez de "Invalid Date".
 */
function formatDate(iso: string, locale: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(d)
}
