// ============================================================
// Traducción de los errores de Postgres que puede devolver la escritura
// de un vehículo, para que el usuario sepa QUÉ corregir.
//
// Nació de un caso real (2026-09-17): un año de seis cifras tecleado en
// un `<input type="date">` hacía que Postgres abortara el INSERT con un
// 22009, y la ruta respondía "No se pudo crear el vehículo" a secas. El
// motivo sólo existía en los logs del servidor, así que desde el CRM el
// error era irresoluble: ni el usuario ni el soporte sabían qué campo
// mirar.
//
// Regla de la casa: un código conocido se traduce a una causa concreta;
// uno desconocido arrastra el mensaje de Postgres como detalle. Feo,
// pero accionable — y quien reporte el problema trae la pista consigo.
// ============================================================

/** Forma mínima de un error de PostgREST/Postgres. */
export interface DbErrorLike {
  code?: string | null
  message?: string | null
  details?: string | null
  hint?: string | null
}

export interface DescribedDbError {
  /** Código HTTP acorde a la causa: 4xx si el usuario puede corregirlo. */
  status: number
  /** Mensaje listo para mostrar. */
  error: string
}

/** Códigos de Postgres con una causa que el usuario puede accionar. */
const KNOWN: Record<string, DescribedDbError> = {
  // unique_violation
  '23505': {
    status: 409,
    error: 'Ya existe un vehículo con esa placa o VIN',
  },
  // foreign_key_violation — el único FK que el formulario puede romper
  // es el del contacto (propietario o comprador).
  '23503': {
    status: 400,
    error: 'El contacto seleccionado ya no existe en la cuenta',
  },
  // check_violation
  '23514': {
    status: 400,
    error:
      'Los datos no cumplen una regla del sistema. Revisa el estado de venta, el precio y el kilometraje',
  },
  // not_null_violation
  '23502': {
    status: 400,
    error: 'Falta un dato obligatorio: revisa marca, modelo y año',
  },
  // insufficient_privilege / RLS
  '42501': {
    status: 403,
    error: 'Tu usuario no tiene permiso para guardar vehículos en esta cuenta',
  },
  // string_data_right_truncation
  '22001': {
    status: 400,
    error: 'Uno de los textos es más largo de lo que acepta el sistema',
  },
}

/**
 * Familia de códigos de formato de fecha/hora (22007 invalid_datetime_format,
 * 22008 datetime_field_overflow, 22009 invalid_time_zone_displacement_value).
 */
const DATE_CODES = new Set(['22007', '22008', '22009'])

/**
 * Convierte un error de la base en un mensaje con causa y su código HTTP.
 *
 * @param error Error devuelto por Supabase/PostgREST, si lo hubo.
 * @param fallback Mensaje base de la operación (p. ej. "No se pudo crear
 *   el vehículo"), usado cuando el código no dice nada útil por sí solo.
 * @returns Estado HTTP y mensaje listo para responder.
 */
export function describeDbError(
  error: DbErrorLike | null | undefined,
  fallback: string,
): DescribedDbError {
  if (!error) return { status: 500, error: fallback }

  const code = error.code ?? ''
  const known = KNOWN[code]
  if (known) return known

  if (DATE_CODES.has(code)) {
    return {
      status: 400,
      error:
        'Hay una fecha inválida: revisa el año de los vencimientos, la compra o la venta (debe estar entre 1900 y 2100)',
    }
  }

  // numeric_value_out_of_range e invalid_text_representation: casi
  // siempre un número mal tecleado.
  if (code === '22003' || code === '22P02') {
    return {
      status: 400,
      error: 'Hay un número inválido: revisa precio, kilometraje y costo',
    }
  }

  const detail = error.message?.trim()
  return {
    status: 500,
    error: detail ? `${fallback}. Detalle: ${detail}` : fallback,
  }
}
