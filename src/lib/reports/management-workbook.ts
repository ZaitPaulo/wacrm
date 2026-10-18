// Libro de Excel del informe de gestión. Separado de `management.ts`
// para que solo la ruta del servidor cargue `exceljs`.

import ExcelJS from 'exceljs';
import {
  MANAGEMENT_COLUMNS,
  MANAGEMENT_REPORT_MAX_ROWS,
  formatDay,
  toSheetRow,
  type ManagementReportRow,
} from './management';

/** Datos de la hoja "Parámetros": quién, cuándo y con qué filtros se generó. */
export interface ManagementWorkbookParams {
  generatedAt: Date;
  generatedBy: string;
  fromKey: string;
  toKey: string;
  /** "Todos", "Sin asignar" o el nombre del asesor. */
  agentLabel: string;
  /** Si la consulta trajo más filas que el máximo. */
  truncated: boolean;
}

/**
 * Las fechas de Excel no llevan zona: se escribe la hora de pared local
 * como si fuera UTC, que es como `exceljs` la serializa. Así 9:00 en
 * Bogotá se ve 9:00 y no 14:00.
 */
function excelDate(d: Date): Date {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000);
}

function parseKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/**
 * Arma el .xlsx del informe: hoja "Clientes" (encabezado fijo, filtro
 * automático y fechas como fecha) y hoja "Parámetros".
 *
 * @param rows Filas de `management_report`, ya recortadas al máximo.
 * @param params Encabezado de la hoja "Parámetros".
 * @returns El archivo listo para responder como descarga.
 */
export async function buildManagementWorkbook(
  rows: ManagementReportRow[],
  params: ManagementWorkbookParams,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'CRM';
  wb.created = params.generatedAt;

  const sheet = wb.addWorksheet('Clientes', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  sheet.columns = MANAGEMENT_COLUMNS.map((c) => ({
    key: c.key,
    header: c.header,
    width: c.width,
    style:
      'date' in c && c.date
        ? { numFmt: 'dd/mm/yyyy', alignment: { vertical: 'top' } }
        : { alignment: { vertical: 'top', wrapText: true } },
  }));

  const header = sheet.getRow(1);
  header.font = { bold: true };
  header.alignment = { vertical: 'middle', wrapText: true };
  header.height = 32;

  for (const row of rows.slice(0, MANAGEMENT_REPORT_MAX_ROWS)) {
    const values = toSheetRow(row, params.generatedAt);
    for (const [key, value] of Object.entries(values)) {
      if (value instanceof Date) {
        (values as Record<string, unknown>)[key] = excelDate(value);
      }
    }
    sheet.addRow(values);
  }

  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: MANAGEMENT_COLUMNS.length },
  };

  const total = Math.min(rows.length, MANAGEMENT_REPORT_MAX_ROWS);
  const info = wb.addWorksheet('Parámetros');
  info.columns = [
    { key: 'k', width: 22 },
    { key: 'v', width: 60 },
  ];
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const infoRows: [string, string | number][] = [
    [
      'Generado',
      `${formatDay(params.generatedAt)} ${params.generatedAt.toTimeString().slice(0, 5)} (${tz})`,
    ],
    ['Generado por', params.generatedBy],
    [
      'Llegada desde',
      formatDay(parseKey(params.fromKey)),
    ],
    ['Llegada hasta', formatDay(parseKey(params.toKey))],
    ['Asesor', params.agentLabel],
    ['Total de clientes', total],
  ];
  if (params.truncated) {
    infoRows.push([
      'Aviso',
      `El informe está recortado a ${MANAGEMENT_REPORT_MAX_ROWS.toLocaleString('es-CO')} clientes. Acota el rango de fechas para verlos todos.`,
    ]);
  }
  for (const [k, v] of infoRows) info.addRow({ k, v });
  info.getColumn('k').font = { bold: true };
  info.getColumn('v').alignment = { wrapText: true, horizontal: 'left' };

  return Buffer.from(await wb.xlsx.writeBuffer());
}
