import { describe, expect, it } from 'vitest';

import { ACCOUNT_ROLES } from '@/lib/auth/roles';
import {
  SECTION_META,
  SETTINGS_SECTIONS,
  canAccessSection,
  defaultSectionForRole,
  resolveSection,
} from './settings-sections';

const ACCOUNT_GROUP_SECTIONS = ['profile', 'security', 'appearance'] as const;

describe('SECTION_META', () => {
  it('marca como adminOnly todo el grupo workspace', () => {
    // La regla: configurar la cuenta es de administración. Si alguien
    // agrega una sección al grupo `workspace` sin la bandera, queda
    // visible para un agente — este test lo caza.
    for (const section of SETTINGS_SECTIONS) {
      if (SECTION_META[section].group === 'workspace') {
        expect(SECTION_META[section].adminOnly).toBe(true);
      }
    }
  });

  it('deja abierto el grupo account', () => {
    for (const section of ACCOUNT_GROUP_SECTIONS) {
      expect(SECTION_META[section].group).toBe('account');
      expect(SECTION_META[section].adminOnly).toBeUndefined();
    }
  });
});

describe('canAccessSection', () => {
  it('deja a cada rol entrar a sus propias secciones de cuenta', () => {
    for (const role of ACCOUNT_ROLES) {
      for (const section of ACCOUNT_GROUP_SECTIONS) {
        expect(canAccessSection(section, role)).toBe(true);
      }
    }
  });

  it('reserva el workspace a admin y owner', () => {
    expect(canAccessSection('whatsapp', 'owner')).toBe(true);
    expect(canAccessSection('whatsapp', 'admin')).toBe(true);
    expect(canAccessSection('whatsapp', 'agent')).toBe(false);
    expect(canAccessSection('whatsapp', 'viewer')).toBe(false);
    expect(canAccessSection('members', 'agent')).toBe(false);
    expect(canAccessSection('api', 'agent')).toBe(false);
  });

  it('falla cerrado sin rol resuelto', () => {
    expect(canAccessSection('whatsapp', null)).toBe(false);
    expect(canAccessSection('profile', null)).toBe(true);
  });
});

describe('defaultSectionForRole', () => {
  it('abre en overview para admin y owner', () => {
    expect(defaultSectionForRole('owner')).toBe('overview');
    expect(defaultSectionForRole('admin')).toBe('overview');
  });

  it('abre en el perfil para agente y viewer', () => {
    // Overview es un tablero de atajos al workspace; para un agente
    // sería una pantalla de enlaces a lugares donde no puede entrar.
    expect(defaultSectionForRole('agent')).toBe('profile');
    expect(defaultSectionForRole('viewer')).toBe('profile');
  });

  it('devuelve siempre una sección que el rol alcanza', () => {
    for (const role of ACCOUNT_ROLES) {
      expect(canAccessSection(defaultSectionForRole(role), role)).toBe(true);
    }
  });
});

describe('resolveSection', () => {
  it('mantiene el mapeo de los tabs viejos para un admin', () => {
    expect(resolveSection('tags', 'admin')).toBe('fields');
    expect(resolveSection('custom-fields', 'admin')).toBe('fields');
    expect(resolveSection('whatsapp', 'admin')).toBe('whatsapp');
    expect(resolveSection(null, 'admin')).toBe('overview');
    expect(resolveSection('inventado', 'admin')).toBe('overview');
  });

  it('degrada a la sección de arranque cuando el rol no alcanza', () => {
    // El caso real: el menú de la cuenta apuntaba fijo a `?tab=whatsapp`,
    // y un enlace así circula reenviado entre compañeros.
    expect(resolveSection('whatsapp', 'agent')).toBe('profile');
    expect(resolveSection('members', 'agent')).toBe('profile');
    expect(resolveSection('tags', 'agent')).toBe('profile');
    expect(resolveSection(null, 'agent')).toBe('profile');
  });

  it('respeta las secciones de cuenta pedidas por un agente', () => {
    expect(resolveSection('profile', 'agent')).toBe('profile');
    expect(resolveSection('security', 'agent')).toBe('security');
    expect(resolveSection('appearance', 'agent')).toBe('appearance');
  });

  it('falla cerrado si se la llama sin rol', () => {
    expect(resolveSection('whatsapp')).toBe('profile');
    expect(resolveSection('profile')).toBe('profile');
  });

  it('nunca devuelve una sección inaccesible para el rol', () => {
    const rawValues = [...SETTINGS_SECTIONS, 'tags', 'custom-fields', 'x', null];
    for (const role of ACCOUNT_ROLES) {
      for (const raw of rawValues) {
        expect(canAccessSection(resolveSection(raw, role), role)).toBe(true);
      }
    }
  });
});
