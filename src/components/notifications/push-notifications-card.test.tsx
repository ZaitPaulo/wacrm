import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

// Catálogo real: la prueba también falla si falta una clave.
const MESSAGES = JSON.parse(readFileSync(join(process.cwd(), 'messages', 'es.json'), 'utf8'))

vi.mock('next-intl', async () => {
  const actual = await vi.importActual<typeof import('next-intl')>('next-intl')
  return {
    ...actual,
    useTranslations: (namespace: string) =>
      actual.createTranslator({
        locale: 'es',
        messages: MESSAGES,
        namespace,
        onError: (err) => {
          throw err
        },
      }),
  }
})

import { PushNotificationsCardView } from './push-notifications-card'
import type { PushCardState, UnblockHelpKey } from '@/lib/push/client'

const P = MESSAGES.Notifications.push

function render(state: PushCardState | null, unblockKey: UnblockHelpKey = 'chromeAndroid') {
  return renderToStaticMarkup(
    <PushNotificationsCardView
      state={state}
      unblockKey={unblockKey}
      busy={false}
      onEnable={() => {}}
      onDisable={() => {}}
      onTest={() => {}}
    />,
  )
}

describe('PushNotificationsCardView', () => {
  it('desactivado: ofrece activar, no la prueba, y explica lo de iPhone', () => {
    const html = render('disabled')
    expect(html).toContain(P.cardTitle)
    expect(html).toContain(P.statusDisabled)
    expect(html).toContain(P.enable)
    expect(html).not.toContain(P.sendTest)
    expect(html).toContain(P.iphoneNote)
  })

  it('activado: prueba y desactivar', () => {
    const html = render('enabled')
    expect(html).toContain(P.statusEnabled)
    expect(html).toContain(P.sendTest)
    expect(html).toContain(P.disable)
    expect(html).not.toContain(`>${P.enable}<`)
    expect(html).toContain(P.enabledHint)
  })

  it('bloqueado: cómo desbloquear en este navegador, sin botón de activar', () => {
    const html = render('blocked', 'chromeAndroid')
    expect(html).toContain(P.statusBlocked)
    expect(html).toContain(P.blockedIntro)
    expect(html).toContain(P.unblock.chromeAndroid)
    expect(html).not.toContain(P.unblock.firefox)
    expect(html).not.toContain(`>${P.enable}<`)
  })

  it('iPhone sin instalar: los pasos para agregar a inicio, sin botón de activar', () => {
    const html = render('ios-install')
    expect(html).toContain(P.statusIosInstall)
    expect(html).toContain(P.iosInstallIntro)
    for (const k of ['iosStep1', 'iosStep2', 'iosStep3', 'iosStep4']) {
      expect(html).toContain(P[k].replace(/“/g, '“'))
    }
    expect(html).not.toContain(`>${P.enable}<`)
  })

  it('iPhone con iOS viejo', () => {
    const html = render('ios-too-old')
    expect(html).toContain(P.statusIosTooOld)
    expect(html).toContain(P.iosTooOldHint)
  })

  it('navegador no compatible', () => {
    const html = render('unsupported')
    expect(html).toContain(P.statusUnsupported)
    expect(html).toContain(P.unsupportedHint)
  })

  it('servidor sin configurar', () => {
    const html = render('server-disabled')
    expect(html).toContain(P.statusServerDisabled)
    expect(html).toContain(P.serverDisabledHint)
  })

  it('mientras revisa el dispositivo lo dice, en una región que se anuncia', () => {
    const html = render(null)
    expect(html).toContain(P.statusLoading)
    expect(html).toContain('aria-live="polite"')
  })

  it('los botones son fáciles de tocar en el celular (44 px de alto)', () => {
    const html = render('enabled')
    expect(html).toMatch(/h-11/)
  })
})
