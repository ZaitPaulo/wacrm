## 1. Regla del filtro

- [x] 1.1 Pruebas de `matchesAssigneeFilter`: todos, sin asignar, un asesor concreto
- [x] 1.2 Implementar `matchesAssigneeFilter` en `src/lib/inbox/conversations.ts`

## 2. Bandeja

- [x] 2.1 Cargar `profiles` en `conversation-list.tsx` solo con permiso `view-all-conversations`
- [x] 2.2 Filtro "Asesor" con conteos, combinado con los demás filtros
- [x] 2.3 Nombre del asesor (o "Sin asignar") en cada fila
- [x] 2.4 Agregar `selectedChannels` a las dependencias del `useMemo` de la lista
- [x] 2.5 Traducciones es/en/ko

## 3. Verificación

- [x] 3.1 Suite, typecheck y lint en verde
- [x] 3.2 Probar en el navegador con un usuario owner y uno agent
