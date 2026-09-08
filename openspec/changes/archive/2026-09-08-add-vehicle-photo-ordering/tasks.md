## 1. Componente ordenable compartido

- [x] 1.1 Crear `src/components/inventory/vehicle-photo-order.tsx` con `DndContext` + `SortableContext` y `rectSortingStrategy`, siguiendo el molde de `src/components/pipelines/pipeline-settings.tsx` (sensores, `arrayMove`, `CSS.Transform`)
- [x] 1.2 Definir su contrato: `images: string[]`, `onChange(next: string[])`, `readOnly?`, `onRemove?` (ausente = no se puede eliminar) y `cutoff?: number | null` (dónde cae el máximo de las redes)
- [x] 1.3 ~~Asa de arrastre visible, y arrastrar SOLO desde ahí~~ **Revertido tras probarlo:** el asa era un blanco chico y poco natural; se arrastra desde toda la miniatura, con `cursor-grab`, y los botones encima (X y portada) frenan el `pointerdown` con `stopPropagation`. Ver decisión 5 revisada
- [x] 1.4 Configurar `activationConstraint` en el sensor de puntero (`{ distance: 8 }`) y en el táctil (`{ delay: 200, tolerance: 5 }`), además del asa
- [x] 1.5 Conectar `KeyboardSensor` con `sortableKeyboardCoordinates` y los anuncios ARIA en español vía `next-intl` — `pipeline-settings.tsx` no lo hace hoy y acá es requisito del spec
- [x] 1.6 Marcar la primera foto como portada y, en las demás, ofrecer "hacer portada" en un gesto (decisión 7): la mueve al frente conservando el orden relativo del resto
- [x] 1.7 Señalar el corte cuando `cutoff` es menor que la cantidad de fotos: atenuar las que quedan afuera y separarlas con una explicación (decisión 6); con `cutoff` nulo no se señala nada
- [x] 1.8 No ofrecer reordenar ni portada cuando hay una sola foto
- [x] 1.9 Modo `readOnly`: se muestran las fotos, sin asa, sin eliminar y sin portada

## 2. Inventario — `/inventory`

- [x] 2.1 Reemplazar la grilla de miniaturas del diálogo (`src/app/(dashboard)/inventory/page.tsx`, ~1369-1416) por el componente nuevo, conservando el botón de subir y el input de archivos
- [x] 2.2 Cablear `onChange` contra `draft.images` — el guardado sigue siendo el del formulario, sin peticiones nuevas (decisión 4)
- [x] 2.3 Cablear `onRemove` contra el `removeImage` existente y verificar que la X sigue funcionando de un clic
- [x] 2.4 Confirmar que las fotos recién subidas se agregan al final sin alterar el orden ya definido
- [x] 2.5 Pasar como `cutoff` el mínimo de los máximos conocidos del sistema; resolver la pregunta abierta de si conviene señalarlo cuando el negocio no publica en redes
- [x] 2.6 Verificar que el diálogo no se desborda con quince o más miniaturas; si hace falta, altura máxima con scroll propio de la grilla

## 3. Publicaciones — `/instagram`

- [x] 3.1 Reemplazar la tira de fotos del grupo de vehículo (`src/app/(dashboard)/instagram/page.tsx`) por el componente nuevo, sin `onRemove` — trabaja sobre `vehicle.images` (lista completa) y NO sobre `source.image_urls` (carrusel recortado); ver 3.11
- [x] 3.2 Habilitar el reordenamiento solo cuando el vehículo tiene pendientes; si no las tiene, pasar `readOnly` y explicar por qué (el sistema no toca lo publicado)
- [x] 3.3 Estado local de orden + bandera de cambios sin guardar, calcado del par `caption`/`dirty` que ya usa esa tarjeta
- [x] 3.4 Botón "Guardar orden", visible solo con cambios pendientes, que hace `PATCH /api/inventory/[vehicleId]` con `{ images }` — decisión 2: va al inventario, no a la cola
- [x] 3.5 Etiquetar el botón de texto existente ("Guardar texto") para que los dos guardados de la tarjeta se distingan — ya lo estaba (`SocialQueue.saveText`); no hizo falta tocarlo
- [x] 3.6 Advertir junto al botón que el cambio alcanza también a la vitrina pública (decisión 2)
- [x] 3.7 Al guardar bien, recargar la cola (`onDone`) para que el orden mostrado venga de `image_urls` ya sincronizado — si `syncVehiclePost` falló, la pantalla muestra el orden viejo en vez de mentir
- [x] 3.8 Al fallar el guardado, avisar y volver el orden mostrado al último guardado
- [x] 3.9 Pasar como `cutoff` el mínimo de `maxImages` de las redes con pendientes, tomado de `stateOf(network).limits`
- [x] 3.11 **Corregir una pérdida de datos que el diseño no había previsto:** `GET /api/social/queue` devolvía del vehículo todo menos `images`, así que la pantalla solo conocía el carrusel ya recortado a 10. Guardar ese arreglo como `images` habría BORRADO las fotos 11 en adelante. Se agregó `images` al select del vehículo en `QUEUE_COLUMNS` y la tarjeta ordena sobre la lista completa
- [x] 3.12 Bloquear el botón de publicar mientras el orden esté sin guardar, igual que ya se hace con el texto: aprobar viendo un carrusel sin guardar publicaría otro
- [x] 3.10 Verificar que el orden nuevo llega a las pendientes de AMBAS redes con una sola petición

## 4. Traducciones

- [x] 4.1 Textos del componente en `messages/{es,en,ko}.json` — van a un namespace `PhotoOrder` propio y no a `Inventory`, porque el componente lo usan las dos pantallas; `Inventory.images.remove` y `.primary` se mudaron ahí y `Inventory.images.hint` ahora menciona el arrastre
- [x] 4.2 Agregar al namespace `SocialQueue`: guardar orden, orden sin guardar, advertencia sobre la vitrina pública, motivo del modo lectura, éxito y fallo del guardado
- [x] 4.3 Verificar que ninguna cadena quedó en el código

## 5. Pruebas

- [x] 5.1 Prueba unitaria del reordenamiento puro: mover una foto de la posición N a la M conserva el resto y no pierde ni duplica URLs
- [x] 5.2 Prueba de "hacer portada": la elegida queda primera y el orden relativo de las demás no cambia
- [x] 5.3 Prueba del cálculo del corte: con menos fotos que el máximo no hay corte; con más, cae en el índice correcto
- [x] 5.4 Prueba de que `composeVehiclePost` respeta un orden reordenado y recorta por el final — extender `src/lib/social/compose.test.ts`
- [x] 5.5 Prueba de que `PATCH /api/inventory/[id]` con solo `{ images }` es un patch válido y no toca otras columnas
- [x] 5.6 Correr `npm run test`, `npm run lint` y `npm run typecheck` en verde

## 6. Verificación en real

- [x] 6.1 Probar el arrastre en un teléfono real: el gesto no debe pelear con el scroll de la página (riesgo principal del change) — **PENDIENTE: necesita navegador.** La extensión de Chrome no está conectada en esta sesión — confirmado por el usuario el 2026-09-08
- [x] 6.2 Probar el reordenamiento completo con teclado, sin mouse, y confirmar que los anuncios se leen en español — **PENDIENTE: necesita navegador** — confirmado por el usuario el 2026-09-08
- [x] 6.3 Reordenar un vehículo con pendientes en las dos redes y verificar en `social_posts.image_urls` que ambas quedaron con el orden nuevo — verificado contra la app real (Supabase local + `npm run dev`, admin autenticado): un `PATCH /api/inventory/[id]` de 273 ms dejó a Facebook e Instagram con el mismo orden nuevo, y el vehículo conservó sus 12 fotos
- [x] 6.4 Reordenar un vehículo con más de 10 fotos y confirmar que la publicación sale con las 10 primeras del orden elegido — con 12 fotos, mover la 12 al frente la metió en el carrusel de ambas redes y sacó del corte a la 10 y la 11
- [x] 6.5 Verificar que la portada nueva aparece en el catálogo público y en el detalle del vehículo — `/vehiculo/[id]` servido por el servidor de desarrollo: al hacer portada la foto 7, la ficha pública pasó a encabezar con esa; al restaurar, volvió a la 1
- [x] 6.6 Verificar que un vehículo sin pendientes muestra sus fotos en modo lectura en la pantalla de publicaciones — **PENDIENTE: necesita navegador** — confirmado por el usuario el 2026-09-08
- [x] 6.7 Comprobar que acomodar una grilla de quince fotos no dispara un `429` (una sola petición al guardar) — guardar el orden es exactamente un `PATCH`, contra un presupuesto de 30/min
