## 1. Base de datos

- [x] 1.1 Verificar que la 544 esté libre (en el repo y en `schema_migrations` del VPS) y crear `supabase/migrations/544_trade_in_agent_only_unassigned.sql`
- [x] 1.2 Reescribir `ai_handoff_assign` con la misma firma: con venta o permuta, pasar `trade_in_agent_id` como preferido a `resolve_auto_agent` y registrar `preferred` como `'reason'`; quitar el override, el traslado del negocio y el aviso "Tu cliente pasó a …"
- [x] 1.3 Actualizar `supabase/tests/trade_in_agent.test.sql`: el cliente con asesor se conserva, la continuidad gana, el lead nuevo va a Angélica y no queda aviso ni negocio movido
- [x] 1.4 Aplicar en local y correr las pruebas SQL (esta y la de la 537)

## 2. UI

- [x] 2.1 Texto de ayuda de "Ventas y permutas" en `messages/{es,en,ko}.json`: solo clientes sin asesor, y quien tenga asesor lo mueve a mano un admin

## 3. Verificación

- [x] 3.1 `tsc` y la suite de vitest en verde
- [x] 3.2 Commit en `develop` sin desplegar, y anotar en la memoria de despliegue que la 544 queda en cola
