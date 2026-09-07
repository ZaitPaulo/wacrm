import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  class ForbiddenError extends Error {
    readonly status = 403 as const;
    constructor(message = 'Forbidden') {
      super(message);
      this.name = 'ForbiddenError';
    }
  }
  class UnauthorizedError extends Error {
    readonly status = 401 as const;
    constructor(message = 'Unauthorized') {
      super(message);
      this.name = 'UnauthorizedError';
    }
  }
  return {
    ForbiddenError,
    UnauthorizedError,
    requireRole: vi.fn(),
    editMessageTemplate: vi.fn(),
    deleteMessageTemplate: vi.fn(),
  };
});

vi.mock('@/lib/auth/account', () => ({
  ForbiddenError: mocks.ForbiddenError,
  UnauthorizedError: mocks.UnauthorizedError,
  requireRole: mocks.requireRole,
  toErrorResponse: vi.fn((err: { status?: number; message?: string }) =>
    Response.json({ error: err.message }, { status: err.status ?? 500 }),
  ),
}));

vi.mock('@/lib/whatsapp/meta-api', () => ({
  editMessageTemplate: mocks.editMessageTemplate,
  deleteMessageTemplate: mocks.deleteMessageTemplate,
}));

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: vi.fn((v: string) => v),
}));

import { DELETE, PATCH } from './route';

// El id tiene que pasar el UUID_RE del handler: la validación de forma
// corre antes que el guard de rol, y un id inválido cortaría en 400 sin
// llegar nunca a `requireRole` — el test no probaría nada.
const TEMPLATE_ID = '11111111-2222-4333-8444-555555555555';
const params = { params: Promise.resolve({ id: TEMPLATE_ID }) };

function patchRequest() {
  return new Request(`http://localhost/api/whatsapp/templates/${TEMPLATE_ID}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ category: 'MARKETING', body_text: 'hola' }),
  });
}

beforeEach(() => {
  mocks.requireRole.mockReset();
  mocks.editMessageTemplate.mockReset();
  mocks.deleteMessageTemplate.mockReset();
});

describe('/api/whatsapp/templates/[id]', () => {
  describe('PATCH', () => {
    it("exige el rol 'admin'", async () => {
      mocks.requireRole.mockRejectedValue(
        new mocks.ForbiddenError("This action requires the 'admin' role or higher"),
      );

      await PATCH(patchRequest(), params);

      expect(mocks.requireRole).toHaveBeenCalledWith('admin');
    });

    it('responde 403 y no toca Meta cuando el rol no alcanza', async () => {
      mocks.requireRole.mockRejectedValue(new mocks.ForbiddenError());

      const response = await PATCH(patchRequest(), params);

      expect(response.status).toBe(403);
      // Lo que de verdad se está protegiendo: editar en Meta es un efecto
      // externo que la RLS no puede deshacer. Antes de este guard la
      // llamada salía primero y la base recién después rechazaba la
      // escritura, dejando la fila local describiendo otra cosa.
      expect(mocks.editMessageTemplate).not.toHaveBeenCalled();
    });

    it('responde 401 cuando no hay sesión', async () => {
      mocks.requireRole.mockRejectedValue(new mocks.UnauthorizedError());

      const response = await PATCH(patchRequest(), params);

      expect(response.status).toBe(401);
      expect(mocks.editMessageTemplate).not.toHaveBeenCalled();
    });
  });

  describe('DELETE', () => {
    it("exige el rol 'admin'", async () => {
      mocks.requireRole.mockRejectedValue(new mocks.ForbiddenError());

      await DELETE(new Request('http://localhost'), params);

      expect(mocks.requireRole).toHaveBeenCalledWith('admin');
    });

    it('responde 403 y no borra en Meta cuando el rol no alcanza', async () => {
      mocks.requireRole.mockRejectedValue(new mocks.ForbiddenError());

      const response = await DELETE(new Request('http://localhost'), params);

      expect(response.status).toBe(403);
      // El borrado en Meta es irreversible, y el borrado local que venía
      // después lo filtraba la RLS sin devolver error — el handler
      // terminaba respondiendo `{ success: true }` por una plantilla
      // destruida afuera y todavía listada en el CRM.
      expect(mocks.deleteMessageTemplate).not.toHaveBeenCalled();
    });
  });
});
