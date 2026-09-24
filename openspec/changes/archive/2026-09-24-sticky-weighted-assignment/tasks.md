## 1. Base de datos (`/backend`)

- [x] 1.1 Verificar que 534-539 no existen en `supabase/migrations/` ni en el VPS
- [x] 1.2 Prueba SQL (roja primero) en `supabase/tests/sticky_weighted_assignment.test.sql`, en transacción con `ROLLBACK`, que cubra los escenarios de las specs
- [x] 1.3 Migración 534: `assignment_settings` y `assignment_weights` con `REVOKE`/`GRANT`, RLS para `owner`/`admin`, constraint trigger diferido de suma 100, trigger que mantiene `stale_assign_enabled_at`, RPC `set_assignment_weights`
- [x] 1.4 Migración 535: `source`/`origin` en `conversation_assignments` y trigger de historial que los copia; `is_active_member`, `is_assignable_agent`, `contact_continuity_agent`; trigger de herencia `BEFORE INSERT`; guarda `protect_sticky_assignment` con escape `crm.assignment_override`
- [x] 1.5 Migración 536: `ensure_open_deal_for_contact` con candado por contacto y trigger `AFTER` de negocio en asignaciones a `agent`
- [x] 1.6 Migración 537: `pick_weighted_agent`, `auto_assign_conversation`, `ai_handoff_assign` (negocio rico antes del UPDATE, aviso al asesor conservado) y `run_stale_assignment_job`
- [x] 1.7 Migración 538: `reactivate_ai_for_returning_lead`
- [x] 1.8 Migración 539: configuración por cuenta, siembra de porcentajes y pausa de la IA en conversaciones asignadas con IA activa
- [x] 1.9 Aplicar en el stack local y dejar verde la prueba SQL; RLS probada con `SET LOCAL ROLE authenticated` y `request.jwt.claims`
- [x] 1.10 Ensayar 531-539 contra una copia de datos del VPS en transacción con `ROLLBACK` (conteos de la siembra y de la pausa)

## 2. Asignación automática en la aplicación (`/backend`)

- [x] 2.1 `src/lib/assignment/auto-assign.ts`: envoltorios de `auto_assign_conversation` y `ai_handoff_assign` con parser puro del `jsonb`, con pruebas
- [x] 2.2 `auto-reply.ts`: quitar la compuerta del asesor, traspaso por `ai_handoff_assign`, nombre del asesor al cliente también cuando se conserva, respaldo si la RPC falla; pruebas
- [x] 2.3 Retirar `pickHandoffAgent` y `createHandoffDeal` (quedan `primerNombre`, `HandoffAgent`, `buildHandoffDealTitle`); ajustar sus pruebas
- [x] 2.4 Automatizaciones: `assign_conversation` por la RPC para cada conversación del contacto (`round_robin` → porcentajes; asesor explícito → preferido); pruebas
- [x] 2.5 Flujos: nodo de derivación y fallback agotado por la RPC (preferido, sin porcentajes); pruebas
- [x] 2.6 `inbound/core.ts`: reactivación del lead que vuelve antes de flujos e IA, best-effort; pruebas
- [x] 2.7 `send-message.ts`: un saliente con `sender_id` pausa la IA; prueba

## 3. Reglas de asignación manual (`/backend` + regla de interfaz)

- [x] 3.1 `src/lib/inbox/assignment.ts`: solo `owner`/`admin` reasignan; `puedeControlarIa`; `asesorAlTomar`; retirar las reglas de service-role; pruebas
- [x] 3.2 `PATCH /api/conversations/[id]/assignee`: `requireRole('admin')`, sesión, sin service-role
- [x] 3.3 `POST /api/ai/autoreply/[id]`: reactivar no toca al asesor; tomar solo asigna si no hay asesor; sin service-role
- [x] 3.4 `canReassignConversations` + `useCan('reassign-conversations')`; `message-thread.tsx` muestra el asesor como texto al `agent`; `ai-thread-banner.tsx` muestra el banner de IA activa aunque haya asesor y no quita al asesor al reanudar
- [x] 3.5 Textos de error de asignación actualizados en `messages/{es,en,ko}.json`

## 4. Configuración y job (`/backend`)

- [x] 4.1 `src/lib/assignment/settings.ts`: validación pura del cuerpo con códigos de error y `assignmentSettingsErrorKey`; pruebas
- [x] 4.2 `GET/PUT /api/assignment/settings` (admin+)
- [x] 4.3 `GET /api/assignment/cron` con `x-cron-secret` y línea en `deploy/cron/crontab`
- [x] 4.4 Claves `Settings.assignment.errors.*` en `es`, `en`, `ko`

## 5. Verificación

- [x] 5.1 `npx vitest run --no-file-parallelism` en verde
- [x] 5.2 `npx tsc --noEmit` limpio
- [x] 5.3 Prueba SQL en verde en el stack local

## 6. Ajustes del Director (2026-09-23)

- [x] 6.1 Reactivación del lead que vuelve solo con asesor `agent` o sin asesor (538), con prueba SQL (propietario de una admin: nunca; sin asesor: sí)
- [x] 6.2 P4 en horas: `stale_assign_after_hours` 1–720 en base (534) y API (`stale_hours_invalid`), con pruebas
- [x] 6.3 "Nunca las de antes": `sin_asesor_desde >= activación` y `ahora − sin_asesor_desde >= X horas` (537), con prueba SQL (rezago, nueva, reciente, cerrada, soltada antes y después)
- [x] 6.4 La 539 deja P4 activado a 3 horas con la marca en el despliegue; cambiar X no reinicia la marca
- [x] 6.5 Cron cada 5 minutos
- [x] 6.6 Clave i18n `Settings.assignment.errors.stale_hours_invalid` (reemplaza `stale_days_invalid`)
- [x] 6.7 Estimación del efecto combinado con datos del VPS (solo lectura) y ensayo 531-539 con ROLLBACK
- [x] 6.8 Actualizar design, specs y proposal
- [x] 6.9 Solo leads que escriben: `EXISTS` de un entrante del cliente y reloj desde `max(sin_asesor_desde, primer entrante)`, nunca antes de la activación (537), con prueba SQL (difusión sin respuesta, respondida hace 4 h, respondida hace 1 h) y costo medido en el VPS con ROLLBACK
