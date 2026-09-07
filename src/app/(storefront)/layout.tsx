import type { ReactNode } from 'react'
import { Barlow, Barlow_Condensed } from 'next/font/google'
import { getShowcaseAccount } from '@/lib/showcase/data'
import { resolveBrandColor } from '@/lib/showcase/format'

const barlow = Barlow({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-barlow',
  display: 'swap',
})

const barlowCondensed = Barlow_Condensed({
  subsets: ['latin'],
  weight: ['600', '700', '800'],
  style: ['normal', 'italic'],
  variable: '--font-barlow-condensed',
  display: 'swap',
})

export default async function StorefrontLayout({
  children,
}: {
  children: ReactNode
}) {
  const account = await getShowcaseAccount()
  const brandColor = resolveBrandColor(account?.public_brand_color)

  return (
    <div
      className={`${barlow.variable} ${barlowCondensed.variable} min-h-screen bg-[#f7f9fb] text-[#191c1e] antialiased`}
      style={
        {
          '--brand': brandColor,
          fontFamily: 'var(--font-barlow), sans-serif',
        } as React.CSSProperties
      }
    >
      {children}
    </div>
  )
}
