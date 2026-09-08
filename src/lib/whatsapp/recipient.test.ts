import { describe, expect, it } from 'vitest';

import { isPhoneRecipient, recipientField } from './recipient';

const BSUID = 'CO.4481978948757066';

describe('isPhoneRecipient', () => {
  it('reconoce un teléfono normalizado', () => {
    expect(isPhoneRecipient('573166220262')).toBe(true);
  });

  it('reconoce que un BSUID no lo es', () => {
    expect(isPhoneRecipient(BSUID)).toBe(false);
    expect(isPhoneRecipient('US.13491208655302741918')).toBe(false);
  });

  it('un teléfono sin normalizar tampoco pasa por teléfono', () => {
    // Todo lo que llega a las funciones de envío pasa antes por
    // sanitizePhoneForMeta. Si algo con signos llegara igual, es
    // preferible que falle el envío a que se mande en el campo
    // equivocado y nadie entienda por qué.
    expect(isPhoneRecipient('+57 316 622 0262')).toBe(false);
  });

  it('la cadena vacía no es un teléfono', () => {
    expect(isPhoneRecipient('')).toBe(false);
  });
});

describe('recipientField', () => {
  it('un teléfono va en `to`, como siempre', () => {
    expect(recipientField('573166220262')).toEqual({ to: '573166220262' });
  });

  it('un BSUID va en `recipient`', () => {
    // Meta NO acepta un BSUID en `to`: es la única forma de alcanzar a
    // quien adoptó un nombre de usuario, porque de esa persona no
    // recibimos el número.
    expect(recipientField(BSUID)).toEqual({ recipient: BSUID });
  });

  it('nunca manda los dos campos a la vez', () => {
    for (const valor of ['573166220262', BSUID]) {
      const campos = Object.keys(recipientField(valor));
      expect(campos).toHaveLength(1);
    }
  });
});
