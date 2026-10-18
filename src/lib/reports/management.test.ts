import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import {
  buildManagementSummary,
  managementReportFilename,
  parseManagementFilters,
  toSheetRow,
  MANAGEMENT_COLUMNS,
  MANAGEMENT_REPORT_MAX_ROWS,
  SUMMARY_TEXT_MAX,
  type ManagementReportRow,
} from './management';
import { buildManagementWorkbook } from './management-workbook';

// Fechas armadas con la hora LOCAL, para que las pruebas no dependan del
// huso de la máquina.
const local = (y: number, m: number, d: number, h = 12) =>
  new Date(y, m - 1, d, h, 0, 0).toISOString();
const NOW = new Date(2026, 9, 17, 15, 0, 0); // 17/10/2026 15:00

function makeRow(overrides: Partial<ManagementReportRow> = {}): ManagementReportRow {
  return {
    contact_id: 'ct-1',
    contact_name: 'Carlos Pérez',
    phone: '573001112233',
    channel: 'whatsapp',
    arrived_at: local(2026, 10, 1),
    agent_id: null,
    agent_name: null,
    pipeline_name: null,
    stage_name: null,
    deal_status: null,
    tags: null,
    last_customer_message_at: null,
    last_agent_message_at: null,
    customer_messages: 0,
    agent_messages: 0,
    automated_messages: 0,
    appointments_total: 0,
    appointments_attended: 0,
    appointments_no_show: 0,
    appointments_cancelled: 0,
    next_appointment_at: null,
    last_note_at: null,
    last_note_author: null,
    last_note_text: null,
    handoff_summary: null,
    ...overrides,
  };
}

describe('buildManagementSummary', () => {
  it('cliente sin nada: solo dice que el asesor no le ha escrito', () => {
    expect(buildManagementSummary(makeRow(), NOW)).toBe(
      'El asesor no le ha escrito',
    );
  });

  it('cliente esperando respuesta desde su último mensaje', () => {
    const summary = buildManagementSummary(
      makeRow({
        last_customer_message_at: local(2026, 10, 15),
        last_agent_message_at: local(2026, 10, 10),
      }),
      NOW,
    );
    expect(summary).toBe(
      'Último mensaje del asesor hace 7 días · Cliente sin respuesta desde 15/10/2026',
    );
  });

  it('no marca espera si el asesor respondió después del cliente', () => {
    const summary = buildManagementSummary(
      makeRow({
        last_customer_message_at: local(2026, 10, 16, 9),
        last_agent_message_at: local(2026, 10, 16, 10),
      }),
      NOW,
    );
    expect(summary).toBe('Último mensaje del asesor ayer');
  });

  it('el asesor nunca escribió pero el cliente sí', () => {
    const summary = buildManagementSummary(
      makeRow({ last_customer_message_at: local(2026, 10, 17, 8) }),
      NOW,
    );
    expect(summary).toBe(
      'El asesor no le ha escrito · Cliente sin respuesta desde 17/10/2026',
    );
  });

  it('citas con próxima y última nota en la segunda línea', () => {
    const summary = buildManagementSummary(
      makeRow({
        last_agent_message_at: local(2026, 10, 17, 9),
        appointments_total: 2,
        appointments_attended: 1,
        appointments_no_show: 1,
        next_appointment_at: local(2026, 10, 20, 10),
        last_note_text: 'Quiere financiar la mitad',
        handoff_summary: 'no debe salir',
      }),
      NOW,
    );
    expect(summary).toBe(
      'Último mensaje del asesor hoy · Citas: 2 (asistió 1, no asistió 1), próxima 20/10/2026\n' +
        'Nota: Quiere financiar la mitad',
    );
  });

  it('sin nota usa el traspaso del bot, recortado a 200 caracteres', () => {
    const summary = buildManagementSummary(
      makeRow({ handoff_summary: 'x'.repeat(500) }),
      NOW,
    );
    const [, second] = summary.split('\n');
    expect(second.startsWith('Traspaso del bot: ')).toBe(true);
    const text = second.slice('Traspaso del bot: '.length);
    expect(text.length).toBe(SUMMARY_TEXT_MAX);
    expect(text.endsWith('…')).toBe(true);
  });
});

describe('parseManagementFilters', () => {
  const parse = (q: string) =>
    parseManagementFilters(new URLSearchParams(q), NOW);

  it('sin rango usa los últimos 30 días hasta hoy', () => {
    const r = parse('');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.filters.fromKey).toBe('2026-09-18');
    expect(r.filters.toKey).toBe('2026-10-17');
    expect(r.filters.toExclusive).toEqual(new Date(2026, 9, 18));
    expect(r.filters.agent).toBeNull();
  });

  it('el rango es inclusivo: "hasta" entra completo', () => {
    const r = parse('from=2026-09-01&to=2026-09-30');
    if (!r.ok) throw new Error(r.error);
    expect(r.filters.from).toEqual(new Date(2026, 8, 1));
    expect(r.filters.toExclusive).toEqual(new Date(2026, 9, 1));
  });

  it('rechaza un rango invertido', () => {
    const r = parse('from=2026-10-10&to=2026-10-01');
    expect(r).toEqual({
      ok: false,
      error: 'La fecha "desde" no puede ser posterior a la fecha "hasta".',
    });
  });

  it('rechaza fechas inválidas', () => {
    expect(parse('from=2026-02-31').ok).toBe(false);
    expect(parse('to=17/10/2026').ok).toBe(false);
  });

  it('acepta unassigned y un uuid, y rechaza cualquier otra cosa', () => {
    const un = parse('agent=unassigned');
    expect(un.ok && un.filters.agent).toBe('unassigned');
    const id = 'B8E22C86-9D53-4489-A848-FD755BB770C9';
    const one = parse(`agent=${id}`);
    expect(one.ok && one.filters.agent).toBe(id.toLowerCase());
    expect(parse('agent=juan').ok).toBe(false);
  });
});

describe('toSheetRow', () => {
  it('usa el teléfono si no hay nombre y "Sin asignar" sin asesor', () => {
    const row = toSheetRow(makeRow({ contact_name: '  ' }), NOW);
    expect(row.client).toBe('573001112233');
    expect(row.agent).toBe('Sin asignar');
    expect(row.channel).toBe('WhatsApp');
    expect(row.arrivedAt).toBeInstanceOf(Date);
  });

  it('traduce el estado del negocio', () => {
    const row = toSheetRow(
      makeRow({
        agent_id: 'u1',
        agent_name: 'Angélica',
        pipeline_name: 'Ventas',
        stage_name: 'Cita agendada',
        deal_status: 'won',
        tags: 'crédito, propietario',
      }),
      NOW,
    );
    expect(row.agent).toBe('Angélica');
    expect(row.dealStatus).toBe('Ganado');
    expect(row.tags).toBe('crédito, propietario');
  });
});

describe('managementReportFilename', () => {
  it('lleva la fecha de generación', () => {
    expect(managementReportFilename(NOW)).toBe('informe-gestion-2026-10-17.xlsx');
  });
});

describe('buildManagementWorkbook', () => {
  const params = {
    generatedAt: NOW,
    generatedBy: 'Ana Owner',
    fromKey: '2026-10-01',
    toKey: '2026-10-17',
    agentLabel: 'Todos',
    truncated: false,
  };

  async function load(buffer: Buffer) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    return wb;
  }

  it('arma las hojas Clientes y Parámetros con encabezado fijo y filtro', async () => {
    const wb = await load(
      await buildManagementWorkbook([makeRow(), makeRow({ contact_id: 'ct-2' })], params),
    );
    const sheet = wb.getWorksheet('Clientes')!;
    expect(sheet).toBeDefined();
    expect(wb.getWorksheet('Parámetros')).toBeDefined();
    expect(sheet.rowCount).toBe(3);
    expect(sheet.getRow(1).getCell(1).value).toBe('Cliente');
    expect(sheet.getRow(1).cellCount).toBe(MANAGEMENT_COLUMNS.length);
    expect(sheet.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
    expect(sheet.autoFilter).toBeTruthy();

    // La fecha de llegada es una fecha de Excel, con la hora de pared local.
    const arrived = sheet.getRow(2).getCell(4).value as Date;
    expect(arrived).toBeInstanceOf(Date);
    expect(arrived.getUTCDate()).toBe(1);
    expect(arrived.getUTCHours()).toBe(12);
  });

  it('sin clientes deja solo los encabezados y el total en 0', async () => {
    const wb = await load(await buildManagementWorkbook([], params));
    expect(wb.getWorksheet('Clientes')!.rowCount).toBe(1);
    const info = wb.getWorksheet('Parámetros')!;
    const total = info.getRows(1, info.rowCount)!.find(
      (r) => r.getCell(1).value === 'Total de clientes',
    );
    expect(total?.getCell(2).value).toBe(0);
  });

  it('recorta al máximo y avisa en Parámetros', async () => {
    const rows = Array.from({ length: MANAGEMENT_REPORT_MAX_ROWS + 1 }, (_, i) =>
      makeRow({ contact_id: `ct-${i}` }),
    );
    const wb = await load(
      await buildManagementWorkbook(rows, { ...params, truncated: true }),
    );
    expect(wb.getWorksheet('Clientes')!.rowCount).toBe(MANAGEMENT_REPORT_MAX_ROWS + 1);
    const info = wb.getWorksheet('Parámetros')!;
    const aviso = info.getRows(1, info.rowCount)!.find(
      (r) => r.getCell(1).value === 'Aviso',
    );
    expect(String(aviso?.getCell(2).value)).toContain('recortado');
  }, 30_000);
});
