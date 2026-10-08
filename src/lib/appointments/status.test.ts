import { describe, expect, it } from 'vitest';
import { availableActions, canDragAppointment } from './status';

describe('availableActions', () => {
  it('asesor con cita programada', () => {
    expect(availableActions('scheduled', 'agent')).toEqual([
      'confirm',
      'attended',
      'no_show',
      'reschedule',
      'cancel',
    ]);
  });

  it('asesor con cita confirmada: ya no ofrece confirmar', () => {
    expect(availableActions('confirmed', 'agent')).not.toContain('confirm');
    expect(availableActions('confirmed', 'agent')).toContain('attended');
  });

  it('admin además reasigna', () => {
    expect(availableActions('scheduled', 'admin')).toContain('reassign');
    expect(availableActions('confirmed', 'owner')).toContain('reassign');
    expect(availableActions('scheduled', 'agent')).not.toContain('reassign');
  });

  it('estados finales: el asesor no puede nada, el admin reabre', () => {
    for (const status of ['attended', 'no_show', 'cancelled'] as const) {
      expect(availableActions(status, 'agent')).toEqual([]);
      expect(availableActions(status, 'admin')).toEqual(['reopen']);
    }
  });

  it('viewer no tiene acciones', () => {
    expect(availableActions('scheduled', 'viewer')).toEqual([]);
    expect(availableActions('cancelled', 'viewer')).toEqual([]);
    expect(availableActions('scheduled', null)).toEqual([]);
  });
});

describe('canDragAppointment', () => {
  it('solo activas y con permiso de escritura', () => {
    expect(canDragAppointment('scheduled', 'agent')).toBe(true);
    expect(canDragAppointment('confirmed', 'admin')).toBe(true);
    expect(canDragAppointment('attended', 'admin')).toBe(false);
    expect(canDragAppointment('scheduled', 'viewer')).toBe(false);
  });
});
