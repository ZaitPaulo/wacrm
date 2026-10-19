## 1. Base de datos

- [x] 1.1 Confirmar que el número 551 está libre en `supabase/migrations/` y en las otras ramas
- [x] 1.2 Crear `551_conversation_awaiting_reply.sql`: columna `conversations.awaiting_reply_since TIMESTAMPTZ NULL` e índice parcial `(account_id, awaiting_reply_since) WHERE awaiting_reply_since IS NOT NULL`
- [x] 1.3 Función `SECURITY DEFINER` + trigger `AFTER INSERT ON messages`: `customer` → `COALESCE(awaiting_reply_since, NEW.created_at)`; `agent` con `sender_id` no nulo → `NULL`; resto sin cambios
- [x] 1.4 Backfill de las conversaciones con actividad en los últimos 7 días (pendiente si hay mensaje `customer` posterior al último `agent`; hora del primer `customer` posterior a esa respuesta)
- [x] 1.5 Aplicar en el stack local y verificar con SQL: entrante fija la hora, segundo entrante la conserva, bot y `agent` sin `sender_id` no la tocan, asesor la limpia, el backfill ignora chats viejos

## 2. Tipos y lógica de bandeja

- [x] 2.1 Agregar `awaiting_reply_since?: string | null` a `Conversation` (`src/types/index.ts`) y a `CONVERSATION_SELECT` / normalización (`src/lib/inbox/conversations.ts`)
- [x] 2.2 Helpers puros en `src/lib/inbox/conversations.ts`: `isAwaitingReply`, `waitTone(since, now)` (`fresh` < 15 min, `warning` < 1 h, `overdue` ≥ 1 h) y comparador por espera más antigua
- [x] 2.3 Pruebas Vitest de los helpers en `src/lib/inbox/conversations.test.ts` (límites de 15 min y 1 h, nulo, orden)

## 3. UI

- [x] 3.1 `conversation-list.tsx`: agregar `'awaiting'` a `InboxFilter` y la opción "Por responder" con su contador (respetando el filtro de asesor y de contacto)
- [x] 3.2 Con el filtro activo, ordenar por espera más antigua; en los demás filtros mantener el orden por `last_message_at`
- [x] 3.3 Etiqueta "Esperando · hace X" con color por `waitTone`, recalculada con un tic de 1 minuto
- [x] 3.4 `message-thread.tsx`: botón "Marcar como atendido" visible solo si la conversación está pendiente; limpia `awaiting_reply_since` con actualización optimista y revierte con aviso si falla
- [x] 3.5 Verificar que el realtime de `conversations` en `inbox/page.tsx` propaga `awaiting_reply_since` (el chat sale del filtro al responder sin recargar)
- [x] 3.6 Textos en el diccionario de español (filtro, etiqueta, botón, aviso de error)

## 4. Verificación

- [x] 4.1 `npm run lint`, `npx tsc --noEmit` y la suite de pruebas en verde
- [x] 4.2 Prueba manual en localhost: entrante → aparece pendiente en verde; respuesta del bot → sigue pendiente; respuesta del asesor → sale del filtro; "Marcar como atendido" → sale; nuevo entrante → vuelve
