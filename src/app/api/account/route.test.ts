import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockSupabase, state } = vi.hoisted(() => {
  const state: { updateData: Record<string, unknown>; updateError: unknown } = {
    updateData: {},
    updateError: null,
  }

  const mockSupabase = {
    from: vi.fn().mockImplementation((table: string) => ({
      select: vi.fn().mockImplementation((cols: string) => ({
        eq: vi.fn().mockImplementation(() => ({
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              showcase_enabled: true,
              public_whatsapp: '123456789',
              public_brand_color: '#e21b22',
              public_name: 'Test Dealer',
              public_logo_url: null,
              public_address: null,
              public_phone: null,
              public_email: null,
              public_hours: null,
            },
            error: null,
          }),
        })),
      })),
      update: vi.fn().mockImplementation((payload: Record<string, unknown>) => {
        state.updateData = payload
        return {
          eq: vi.fn().mockImplementation(() => ({
            select: vi.fn().mockImplementation(() => ({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: 'acc-1',
                  name: 'Test Account',
                  showcase_enabled: true,
                  public_whatsapp: '123456789',
                  public_brand_color: payload.public_brand_color ?? null,
                },
                error: state.updateError,
              }),
            })),
          })),
        }
      }),
    })),
  }

  return { mockSupabase, state }
})

vi.mock('@/lib/auth/account', () => ({
  requireRole: vi.fn().mockResolvedValue({
    userId: 'user-1',
    accountId: 'acc-1',
    role: 'admin',
    supabase: mockSupabase,
  }),
  getCurrentAccount: vi.fn().mockResolvedValue({
    userId: 'user-1',
    accountId: 'acc-1',
    role: 'admin',
    account: { id: 'acc-1', name: 'Test Account' },
    supabase: mockSupabase,
  }),
  toErrorResponse: vi.fn().mockImplementation((err) =>
    new Response(JSON.stringify({ error: String(err) }), { status: 500 }),
  ),
}))

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockReturnValue({ success: true }),
  rateLimitResponse: vi.fn(),
  RATE_LIMITS: { adminAction: {} },
}))

import { GET, PATCH } from './route'

describe('/api/account public_brand_color handling', () => {
  beforeEach(() => {
    state.updateData = {}
    state.updateError = null
    vi.clearAllMocks()
  })

  it('includes public_brand_color in GET response', async () => {
    const res = await GET()
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.account).toHaveProperty('public_brand_color', '#e21b22')
  })

  it('rejects invalid hex color format with status 400', async () => {
    const invalidColors = ['red', '#fff', '123456', '#1234567', '#zzz123']

    for (const color of invalidColors) {
      const req = new Request('http://localhost/api/account', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ public_brand_color: color }),
      })
      const res = await PATCH(req)
      expect(res.status).toBe(400)
      const json = await res.json()
      expect(json.error).toBeDefined()
    }
  })

  it('accepts valid 6-digit hex color format and updates account', async () => {
    const req = new Request('http://localhost/api/account', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ public_brand_color: '#0059bb' }),
    })
    const res = await PATCH(req)
    expect(res.status).toBe(200)
    expect(state.updateData).toHaveProperty('public_brand_color', '#0059bb')
  })

  it('accepts null or empty string to reset public_brand_color to null', async () => {
    const reqNull = new Request('http://localhost/api/account', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ public_brand_color: null }),
    })
    const resNull = await PATCH(reqNull)
    expect(resNull.status).toBe(200)
    expect(state.updateData).toHaveProperty('public_brand_color', null)

    const reqEmpty = new Request('http://localhost/api/account', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ public_brand_color: '' }),
    })
    const resEmpty = await PATCH(reqEmpty)
    expect(resEmpty.status).toBe(200)
    expect(state.updateData).toHaveProperty('public_brand_color', null)
  })
})
