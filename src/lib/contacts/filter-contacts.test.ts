import { describe, it, expect } from 'vitest';
import { filterContacts, type PickableContact } from './filter-contacts';

const CONTACTOS: PickableContact[] = [
  { id: '1', name: 'José Plata', phone: '573168774697' },
  { id: '2', name: 'Royse Salas', phone: '+57 324 444 5896' },
  { id: '3', name: 'Alberto Barros', phone: '573008052232' },
  { id: '4', name: 'Alberto Barros', phone: '573015537277' },
  { id: '5', name: null, phone: '573054505585' },
];

const ids = (r: { shown: PickableContact[] }) => r.shown.map((c) => c.id);

describe('filterContacts', () => {
  it('sin búsqueda devuelve todos, hasta el tope', () => {
    expect(ids(filterContacts(CONTACTOS, '', 10))).toEqual(['1', '2', '3', '4', '5']);
  });

  it('ignora mayúsculas y tildes', () => {
    expect(ids(filterContacts(CONTACTOS, 'JOSE', 10))).toEqual(['1']);
  });

  it('busca por palabras en cualquier orden', () => {
    expect(ids(filterContacts(CONTACTOS, 'plata jose', 10))).toEqual(['1']);
  });

  it('busca por teléfono sin importar el formato', () => {
    expect(ids(filterContacts(CONTACTOS, '324 4445896', 10))).toEqual(['2']);
    expect(ids(filterContacts(CONTACTOS, '4505585', 10))).toEqual(['5']);
  });

  it('con menos de tres dígitos no busca por teléfono', () => {
    expect(ids(filterContacts(CONTACTOS, '57', 10))).toEqual([]);
  });

  it('devuelve los dos homónimos para que se elija por el teléfono', () => {
    expect(ids(filterContacts(CONTACTOS, 'alberto', 10))).toEqual(['3', '4']);
  });

  it('informa cuántos quedaron fuera del tope', () => {
    expect(filterContacts(CONTACTOS, '', 2)).toMatchObject({ hidden: 3 });
  });
});
