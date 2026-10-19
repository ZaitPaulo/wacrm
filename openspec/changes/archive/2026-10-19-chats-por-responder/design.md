## Context

- `messages.sender_type` ∈ `customer | agent | bot` (001). Los asesores envían por `sendMessageToConversation` (`src/lib/whatsapp/send-message.ts`), que guarda `sender_type = 'agent'` con `sender_id` = el usuario (`/api/whatsapp/send` pasa `senderId: userId`); la API v1 usa la misma función con `sender_id` nulo.
- Bot de IA, automatizaciones (`lib/automations/meta-send.ts`), flujos (`lib/flows/meta-send.ts`) y recordatorios de citas (`lib/appointments/send.ts`) guardan `sender_type = 'bot'`.
- Los entrantes los guarda `lib/inbound/core.ts` con `sender_type = 'customer'` y luego `bump_conversation_on_inbound` (037) sube `unread_count`.
- `unread_count` lo pone en 0 el cliente al abrir el hilo (`message-thread.tsx:511`). La bandeja carga `conversations` con `CONVERSATION_SELECT` y escucha cambios por realtime.
- Antes de la migración 532 los mensajes de asesor no tenían `sender_id`.

## Goals / Non-Goals

**Goals:**
- Que cada asesor vea qué chats le deben respuesta y desde cuándo, independiente de si los abrió.
- Que el estado sea correcto aunque el mensaje entre por cualquier camino (webhook, API, automatización) sin tocar cada uno.

**Non-Goals:**
- Medir tiempos de respuesta por asesor (ya lo hace `agent-performance-metrics`).
- Avisos o escalamientos por espera larga (ya existe el SLA de traspaso, 546).
- Cambiar el comportamiento de "No leídos".

## Decisions

1. **Columna desnormalizada `awaiting_reply_since TIMESTAMPTZ NULL` en `conversations`**, no un cálculo al vuelo sobre `messages`. La bandeja ya lista `conversations` y filtra en memoria; una columna llega gratis por `CONVERSATION_SELECT` y por realtime. Alternativa descartada: vista/consulta con `MAX(created_at)` por remitente → costosa en cada carga y no viaja por realtime.

2. **Trigger `AFTER INSERT ON messages`** (función `SECURITY DEFINER`, `search_path = public`) en lugar de actualizar desde cada ruta de envío. Hay al menos seis puntos que insertan mensajes; el trigger cubre todos y los futuros. Reglas:
   - `customer` → `SET awaiting_reply_since = COALESCE(awaiting_reply_since, NEW.created_at)`.
   - `agent` con `sender_id IS NOT NULL` → `SET awaiting_reply_since = NULL`.
   - cualquier otro → nada.
   El `UPDATE` es atómico, sin leer-modificar-escribir (misma lección que 037).

3. **"Humano" = `sender_type = 'agent' AND sender_id IS NOT NULL`.** Así la API v1 (integraciones, sin persona detrás) no cierra esperas, coherente con cómo 532 atribuye respuestas. Decisión del cliente: el bot nunca cuenta como respondido, ni siquiera mientras está activo.

4. **Backfill solo de los últimos 7 días, y contando cualquier mensaje `agent`** (con o sin `sender_id`). Los mensajes históricos de asesor anteriores a 532 no tienen `sender_id`; exigirlo marcaría como pendientes chats ya atendidos. Limitar a 7 días evita cientos de chats viejos en rojo el primer día.

5. **"Marcar como atendido" desde el cliente** con `supabase.from('conversations').update({ awaiting_reply_since: null })`, igual que hoy se hace con `unread_count`; la RLS de `conversations` ya permite al asesor actualizar las de su cuenta. No hace falta ruta API nueva (sigue los patrones del repo, sin Server Actions).

6. **Filtro y orden en memoria** con un helper puro en `src/lib/inbox/conversations.ts` (`isAwaitingReply`, `waitTone(since, now)` → `fresh | warning | overdue`, comparador por espera), testeable con Vitest como `matchesAssigneeFilter`. El filtro "Por responder" se agrega como valor de `InboxFilter` (junto a `unread`). La etiqueta se recalcula con un tic de 1 minuto para que el color cambie sin recargar.

7. **Índice parcial** `ON conversations (account_id, awaiting_reply_since) WHERE awaiting_reply_since IS NOT NULL` por si después se consulta del lado del servidor (contador, métricas); es barato porque solo indexa las pendientes.

## Risks / Trade-offs

- [Los chats que el bot atiende solo aparecerán "Por responder"] → Es lo que pidió el cliente; el asesor los cierra respondiendo o con "Marcar como atendido". Se avisa en el resumen de entrega.
- [Las campañas a propietarios no cierran nada, pero sus respuestas abren esperas] → Correcto: si el propietario contesta, alguien debe atenderlo.
- [Una respuesta enviada desde el celular del negocio (WhatsApp Business app) no pasa por el CRM] → No llega como mensaje `agent`; el chat queda pendiente. Se resuelve con "Marcar como atendido". Igual que hoy con las métricas.
- [Inserción de mensajes en lote (backfills, importaciones) dispara el trigger fila por fila] → Un `UPDATE` por fila con PK; aceptable al volumen actual.
- [Olvidar el GRANT] → La columna es nueva en una tabla existente, hereda los permisos; no aplica el problema de tablas nuevas, pero se verifica en local que el cliente pueda leer y limpiar la columna.

## Migration Plan

1. Migración `551_conversation_awaiting_reply.sql`: columna, índice, función + trigger, backfill. Verificar antes que ningún otro cambio use el 551 (colisión de números).
2. Probar en local con `supabase` (aplicar migraciones a mano: `supabase start` no las aplica) y la bandeja en localhost.
3. Desplegar junto con el frontend en el siguiente despliegue acordado (develop → main).
4. Rollback: `DROP TRIGGER`, `DROP FUNCTION`, `ALTER TABLE conversations DROP COLUMN awaiting_reply_since`; el frontend tolera la columna ausente (se trata como no pendiente).

## Open Questions

- Ninguna bloqueante. A futuro: mostrar el contador de pendientes en el menú lateral junto a los no leídos, si los asesores lo piden.
