import { describe, expect, it } from 'vitest';
import { metaErrorFromResponse } from './errors';

// Caso real (2026-09-17): publicar un carrusel de 10 fotos en Instagram
// falló dos veces seguidas con el error genérico de Meta, y al tercer
// intento salió sin que nadie tocara nada. El cliente vio el texto crudo
// en inglés —"An unexpected error has occurred. Please retry your request
// later."— sin forma de saber si el problema era su vehículo, sus fotos o
// Meta. Era Meta.

function metaResponse(body: unknown, status = 400): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('metaErrorFromResponse — fallos pasajeros de Meta', () => {
  it('traduce el error genérico (código 2) a algo accionable', async () => {
    const err = await metaErrorFromResponse(
      metaResponse({
        error: {
          message:
            'An unexpected error has occurred. Please retry your request later.',
          code: 2,
        },
      }),
      'fallback',
      'container'
    );

    expect(err.transient).toBe(true);
    // Que quede claro que no es por el vehículo ni por las fotos.
    expect(err.message).toMatch(/temporal/i);
    expect(err.message).toMatch(/fotos/i);
    // El código de Meta se conserva para el log y para diagnosticar.
    expect(err.code).toBe(2);
    expect(err.step).toBe('container');
    // Sigue siendo un fallo de contenido, no de credenciales: nadie
    // debe salir corriendo a reconectar la cuenta.
    expect(err.kind).toBe('content');
  });

  it('reconoce el aviso explícito de Meta (is_transient)', async () => {
    const err = await metaErrorFromResponse(
      metaResponse({
        error: { message: 'Please retry', code: 1, is_transient: true },
      }),
      'fallback'
    );

    expect(err.transient).toBe(true);
  });

  it('NO enmascara un error de contenido de verdad', async () => {
    // Un rechazo por la foto tiene que llegar tal cual: es lo único que
    // le dice al usuario que el problema está en su vehículo.
    const err = await metaErrorFromResponse(
      metaResponse({
        error: {
          message: 'The aspect ratio is not supported',
          code: 36003,
        },
      }),
      'fallback'
    );

    expect(err.transient).toBe(false);
    expect(err.message).toBe('The aspect ratio is not supported');
    expect(err.kind).toBe('content');
  });

  it('NO confunde un token vencido con un fallo pasajero', async () => {
    const err = await metaErrorFromResponse(
      metaResponse({
        error: { message: 'Error validating access token', code: 190 },
      }),
      'fallback'
    );

    expect(err.transient).toBe(false);
    expect(err.kind).toBe('credentials');
  });
});
