import { describe, it, expect } from 'vitest';
import type { MessageTemplate } from '@/types';
import { checkFollowUpTemplate } from './follow-up-template';

function plantilla(overrides: Partial<MessageTemplate> = {}): MessageTemplate {
  return {
    id: 't',
    user_id: 'u',
    name: 'plantilla',
    category: 'Utility',
    language: 'es_CO',
    body_text: 'Hola, ¿sigue disponible?',
    created_at: '2026-09-14T00:00:00Z',
    ...overrides,
  };
}

describe('checkFollowUpTemplate — variables del cuerpo', () => {
  it('acepta un recordatorio sin variables aunque el original tenga', () => {
    const original = plantilla({ body_text: 'Hola {{1}}' });
    const recordatorio = plantilla({ body_text: 'Seguimos atentos' });

    expect(checkFollowUpTemplate(original, recordatorio)).toEqual({
      ok: true,
      sendsParams: false,
    });
  });

  it('acepta el mismo número de variables y reutiliza los valores', () => {
    const original = plantilla({ body_text: 'Hola {{1}}, tu {{2}}' });
    const recordatorio = plantilla({ body_text: '{{1}}, ¿tu {{2}} sigue?' });

    expect(checkFollowUpTemplate(original, recordatorio)).toEqual({
      ok: true,
      sendsParams: true,
    });
  });

  it('rechaza un recordatorio con variables si el original no tiene', () => {
    const original = plantilla({ body_text: 'Hola' });
    const recordatorio = plantilla({ body_text: 'Hola {{1}}' });

    expect(checkFollowUpTemplate(original, recordatorio)).toEqual({
      ok: false,
      problem: 'variable_mismatch',
    });
  });

  it('rechaza un número de variables distinto', () => {
    const original = plantilla({ body_text: '{{1}} {{2}}' });
    const recordatorio = plantilla({ body_text: '{{1}}' });

    expect(checkFollowUpTemplate(original, recordatorio)).toMatchObject({
      ok: false,
      problem: 'variable_mismatch',
    });
  });
});

describe('checkFollowUpTemplate — encabezado', () => {
  it.each(['image', 'video', 'document'] as const)(
    'rechaza un encabezado de %s',
    (header_type) => {
      const recordatorio = plantilla({
        header_type,
        header_media_url: 'https://example.com/x',
      });

      expect(checkFollowUpTemplate(plantilla(), recordatorio)).toEqual({
        ok: false,
        problem: 'media_header',
      });
    }
  );

  it('rechaza un encabezado de texto con variable', () => {
    const recordatorio = plantilla({
      header_type: 'text',
      header_content: 'Hola {{1}}',
    });

    expect(checkFollowUpTemplate(plantilla(), recordatorio)).toEqual({
      ok: false,
      problem: 'header_variable',
    });
  });

  it('acepta un encabezado de texto fijo', () => {
    const recordatorio = plantilla({
      header_type: 'text',
      header_content: 'LORAMOTORS',
    });

    expect(checkFollowUpTemplate(plantilla(), recordatorio)).toMatchObject({
      ok: true,
    });
  });
});

describe('checkFollowUpTemplate — botones', () => {
  it('acepta respuestas rápidas', () => {
    const recordatorio = plantilla({
      buttons: [
        { type: 'QUICK_REPLY', text: 'SI' },
        { type: 'QUICK_REPLY', text: 'NO' },
      ],
    });

    expect(checkFollowUpTemplate(plantilla(), recordatorio)).toMatchObject({
      ok: true,
    });
  });

  it('rechaza un botón URL con variable', () => {
    const recordatorio = plantilla({
      buttons: [
        { type: 'URL', text: 'Ver', url: 'https://loramotors.co/v/{{1}}' },
      ],
    });

    expect(checkFollowUpTemplate(plantilla(), recordatorio)).toEqual({
      ok: false,
      problem: 'button_needs_value',
    });
  });

  it('acepta un botón URL fijo y un COPY_CODE, que cae a su ejemplo', () => {
    const recordatorio = plantilla({
      buttons: [
        { type: 'URL', text: 'Ver', url: 'https://loramotors.co' },
        { type: 'COPY_CODE', text: 'Copiar', example: 'LORA10' },
      ],
    });

    expect(checkFollowUpTemplate(plantilla(), recordatorio)).toMatchObject({
      ok: true,
    });
  });
});
