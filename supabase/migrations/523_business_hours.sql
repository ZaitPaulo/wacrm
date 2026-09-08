-- ============================================================
-- 523_business_hours.sql
--
-- Horario de atención por cuenta: cuándo el sistema puede escribirle a
-- un cliente POR SU CUENTA.
--
-- La regla que esto habilita:
--   RESPONDER a quien escribió se puede siempre, a cualquier hora.
--   ESCRIBIR por iniciativa propia —un seguimiento programado, una
--   automatización disparada por una etiqueta— solo en horario.
--
-- El caso que lo motivó es concreto: una automatización con un paso
-- "esperar 24 horas" seguido de un mensaje dispara cuando vence la
-- espera, y el cron que la despierta corre cada minuto las 24 horas.
-- Una espera de 10 horas creada a las 6 de la tarde le escribe al
-- cliente a las 4 de la mañana.
--
-- ## Por qué por día de la semana y no una sola franja
--
-- Una franja única ("silencio de 19:00 a 7:00") no puede expresar
-- "domingo cerrado", y un seguimiento saldría el domingo a mediodía
-- como si fuera un martes. Los horarios reales de un negocio varían por
-- día: el de LoraMotors es L-V 8:00-18:00, sábado 8:00-14:00, domingo
-- cerrado.
--
-- ## Por qué JSONB y no una tabla
--
-- Son siete filas fijas que se leen SIEMPRE juntas y nunca por
-- separado, no se consultan por sus valores, y no las referencia nadie.
-- Una tabla añadiría un join a un camino —el de cada envío— donde lo
-- que se quiere es una lectura y ya.
--
-- ## Por qué NO se guarda la zona horaria
--
-- El horario se compara contra el reloj del proceso, igual que la
-- condición `time_of_day` que ya existía. El contenedor corre con
-- TZ=America/Bogota. Guardar una zona por cuenta sin que haya cuentas
-- en husos distintos solo agregaría conversiones donde hoy no hay
-- ninguna — y con ellas, sus errores. Ver src/lib/outbound/business-hours.ts.
--
-- Apagado por defecto: una instalación que no lo configure se comporta
-- exactamente como antes.
--
-- Idempotente — seguro de re-ejecutar.
-- ============================================================

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS quiet_hours_enabled BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS business_hours JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN accounts.quiet_hours_enabled IS
  'Cuando es true, los envios por iniciativa del sistema se aplazan hasta la proxima apertura. Las respuestas a un cliente que escribio NO se ven afectadas nunca.';

COMMENT ON COLUMN accounts.business_hours IS
  'Horario de atencion por dia: {"mon":["08:00","18:00"], ..., "sun":null}. Claves sun/mon/tue/wed/thu/fri/sat; null o ausente es dia cerrado. Se compara contra el reloj del proceso (TZ del contenedor).';
