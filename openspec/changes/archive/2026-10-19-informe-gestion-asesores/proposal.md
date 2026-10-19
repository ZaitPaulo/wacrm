## Why

El dueño de Lora Motors quiere saber qué está pasando con cada cliente y qué ha hecho cada asesor con él, sin abrir chat por chat. Hoy esa información está repartida entre la bandeja, el embudo, la Agenda, las notas del contacto y el resumen que deja el bot al traspasar, y no hay forma de verla toda junta ni de llevársela a una hoja de cálculo. Ya se midió que el cuello de botella está en el asesor: el 32 % de los traspasos quedan sin atender. El dueño necesita un listado para hacer seguimiento.

## What Changes

- Nuevo **informe de gestión** que se descarga como Excel (`.xlsx`): una fila por cliente con:
  - cliente, teléfono y canal;
  - fecha de llegada;
  - asesor que lo atiende;
  - embudo, etapa y estado del negocio más reciente;
  - etiquetas;
  - un **resumen de gestión** armado automáticamente con datos que ya existen, sin IA: último mensaje del cliente y del asesor (con fecha), número de mensajes de cada uno, citas (agendadas, asistió, no asistió, cancelada, próxima cita), última nota del asesor y el resumen del traspaso del bot. Además de las columnas sueltas, una columna de texto junta todo en dos o tres líneas para leerlo rápido.
- Filtros al descargar: rango de fecha de llegada (por defecto, los últimos 30 días) y asesor (todos, uno o "sin asignar").
- Botón **"Informe de gestión"** en la cabecera de Contactos. Solo lo ven `owner` y `admin`, y abre un diálogo pequeño con los filtros y el botón de descarga. No se crea una pantalla nueva.
- La generación es **solo para `admin` o superior** también en el servidor: un asesor que llame la ruta directamente recibe 403.
- Los contactos fusionados (`merged_into_contact_id` no nulo) no aparecen: su historia ya está en el contacto que los absorbió.

## Capabilities

### New Capabilities
- `advisor-management-report`: el informe de gestión descargable, es decir, quién puede generarlo, qué filtros acepta, qué columnas trae y de dónde sale cada dato (asesor, fecha de llegada, negocio, etiquetas y resumen de gestión).

### Modified Capabilities
<!-- Ninguna: no cambian requisitos de visibilidad, asignación ni embudo; el informe solo lee. -->

## Impact

- **Base de datos:** una migración con la función `management_report(...)`, `SECURITY INVOKER`, que devuelve una fila por contacto con los agregados. Como es `INVOKER`, aplica la RLS de quien la llama; la ruta además exige `admin`. Lleva `GRANT EXECUTE` a `authenticated`. El número de migración se elige al implementar, porque `chats-por-responder` y `hoja-de-vida-contacto` tienen reservados del 551 en adelante (ver la memoria de colisión de números). No hay tablas nuevas ni cambios de RLS.
- **API:** nueva `GET src/app/api/reports/management/route.ts`, que exige `requireRole('admin')`, valida los filtros, llama a la función, arma el `.xlsx` y lo devuelve como descarga.
- **Lógica pura:** `src/lib/reports/management.ts`, que arma el resumen de texto y mapea filas a columnas. Lleva pruebas con Vitest.
- **UI:** `src/app/(dashboard)/contacts/page.tsx` (botón, solo `canManageMembers`), un componente de diálogo nuevo en `src/components/contacts/` y textos en `messages/es.json` y `messages/en.json`.
- **Dependencias:** se agrega `exceljs`, que solo se usa en el servidor. Hoy el proyecto no tiene ninguna librería de hojas de cálculo.
- **Sin cambios:** la bandeja, el embudo, la Agenda, la visibilidad por asignación (520) y `hoja-de-vida-contacto`, de la que este cambio no depende. Si más adelante se implementa `deal_stage_events`, el informe podrá sumar la columna "en esta etapa desde".
