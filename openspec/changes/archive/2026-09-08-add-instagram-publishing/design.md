## Context

El disparador natural ya existe y es inequívoco: un vehículo pasa a `status = 'available'`. Eso es lo que hoy lo hace aparecer en la vitrina, y es el mismo momento en el que tendría sentido ofrecerlo en Instagram.

Lo que el repositorio ya aporta, verificado:

```
Credenciales   whatsapp_config + encrypt()/decrypt()   → patrón por cuenta, token cifrado
Fotos          bucket showcase-media, PÚBLICO (506)    → Meta exige URLs accesibles
Trabajo diferido  /api/automations/cron, /api/flows/cron → protegidas por secreto
Irreversibilidad  broadcasts.delivery_locked_at (038)   → mutex contra doble envío
Cliente Meta   src/lib/whatsapp/meta-api.ts            → estilo a imitar
```

Ese último punto de la tabla es el más instructivo. La migración 038 puso un mutex en las difusiones con este razonamiento explícito: *"dos clics enviarían el mensaje dos veces, y un mensaje de WhatsApp no se puede recall"*. Una publicación de Instagram tiene exactamente el mismo problema, y merece exactamente la misma protección.

**Lo que exige Meta**, leído de su documentación vigente el 2026-08-12:

```
Publicación      POST /<IG_ID>/media  →  POST /<IG_ID>/media_publish
Carrusel         hasta 10 elementos; el recorte lo fija la 1.ª imagen (1:1 por defecto)
Imágenes         JPEG, y solo JPEG
Texto            2200 caracteres, máximo 30 hashtags
Tope             GET /<IG_ID>/content_publishing_limit
                 → quota_usage + config{quota_total, quota_duration}
Cuenta           profesional; permisos instagram_business_basic
                 + instagram_business_content_publish
```

Dos de esas líneas contradicen supuestos que traía este change y se tratan más abajo: el formato JPEG (decisión 12) y la página de Facebook, que el camino de autenticación elegido ya no exige (decisión 13).

## Goals / Non-Goals

**Goals**
- Que preparar la publicación sea automático y publicarla sea deliberado.
- Que nada se publique dos veces, ni siquiera con dos clics simultáneos.
- Que un vehículo vendido no llegue a publicarse por estar viejo en la cola.
- Que el negocio conserve el control de su feed.

**Non-Goals**
- Publicar sin intervención humana.
- Historias, otras redes, programación horaria.
- Borrar publicaciones automáticamente cuando el auto se vende.

## Decisions

### 1. Una cola con estados explícitos, no un booleano

Tabla de publicaciones con estado: `borrador` → `publicada`, con salidas a `descartada` y `fallida`. Una fila por vehículo y red.

*Alternativa descartada:* una bandera `publicado_en_instagram` en `inventory_vehicles`. No permite guardar el texto editado, ni el motivo de un fallo, ni el identificador que devuelve Meta, ni distinguir "nunca se quiso publicar" de "se intentó y falló".

### 2. Encolar es barato; publicar es caro

Al pasar a `available` se crea el borrador. Si ya existe uno para ese vehículo, no se duplica: reingresar un auto al inventario no debe generar una segunda publicación pendiente.

Encolar **nunca** debe hacer fallar el guardado del vehículo. Es un efecto secundario best-effort, igual que el sync con el knowledge base o la atribución de consultas: si falla, se registra y el vehículo se guarda igual.

### 3. La validación ocurre al publicar, no solo al encolar

Entre que se prepara la publicación y alguien la aprueba pueden pasar días. Antes de enviar a Meta se revalida que el vehículo siga disponible y que sus fotos sigan existiendo. Un auto vendido hace tres días no se publica aunque su borrador esté aprobado.

*Por qué no confiar en el encolado:* el estado del inventario cambia por caminos que la cola no observa —una venta, una edición, un borrado— y publicar un auto que ya no está genera consultas de algo inexistente, que es peor que no haber publicado.

### 4. Candado de publicación, calcado del de difusiones

Un campo de bloqueo que se toma condicionalmente antes de hablar con Meta y se libera al terminar. Dos clics simultáneos: solo uno lo obtiene.

El identificador que devuelve Meta se guarda como prueba de publicación. Si el proceso muere después de publicar pero antes de guardar, ese hueco se detecta comparando contra Meta, nunca republicando por las dudas.

### 5. Vender no despublica, avisa

Cuando se vende un vehículo con publicación viva, el sistema lo señala en la cola. No borra nada.

*Por qué:* borrar una publicación con interacción destruye el alcance que ya ganó, y no siempre es lo que el negocio quiere —muchas compraventas prefieren dejarla y comentar "vendido", que funciona como prueba social. La decisión es de marketing, no del sistema.

### 6. El tope no se calcula: se le pregunta a Meta

Meta limita cuántas publicaciones acepta por periodo. El sistema lo muestra en la cola y no intenta publicar cuando ya no queda margen — igual que la ventana de respuesta en mensajería, se impide antes en vez de descubrirlo por el rechazo.

**El número no se guarda en ninguna parte.** Meta expone `GET /<IG_ID>/content_publishing_limit`, que devuelve el consumo actual y el tope vigente. Se consulta antes de aprobar y se muestra ese resultado.

*Por qué no una constante:* al escribir esto, las propias docs de Meta se contradicen — la guía de content publishing dice 100 publicaciones por 24 horas y la referencia del endpoint dice que `quota_total` es "currently 50". Una constante en el código nace desactualizada y falla en la dirección peligrosa: creerse con margen que no hay. El endpoint siempre dice la verdad.

*Consecuencia:* el tope cuenta **contenedores publicados**, no vehículos. Un carrusel es un contenedor, así que la cuenta es una por publicación aprobada.

### 7. Las fotos se sirven desde el bucket público

Meta descarga la imagen desde una URL accesible. `showcase-media` ya es público (migración 506), así que no hace falta infraestructura nueva.

*Consecuencia a tener presente:* un vehículo cuyas fotos vengan de un dominio externo depende de que ese dominio siga sirviéndolas. La validación previa a publicar debe comprobar que las URLs responden.

### 8. Carrusel con las fotos que ya existen, sin placa de datos

La publicación es un carrusel de hasta 10 imágenes tomadas de `inventory_vehicles.images`, en su orden actual. Los datos van en el texto.

*Alternativa descartada — imagen única:* una foto suelta rinde poco para vender un auto, y el material para el carrusel ya está cargado: la vitrina muestra la galería completa y a quien carga el vehículo no hay que pedirle nada nuevo.

*Alternativa diferida — carrusel con placa de datos:* lo habitual en el rubro es cerrar con una imagen generada que repita precio, año y kilometraje. El repositorio no tiene con qué componer imágenes —`sharp` solo entra como dependencia de Next—, así que habría que generar el PNG (`ImageResponse` de `next/og` sería el camino) y subirlo al bucket para que Meta pueda descargarlo. Es una feature completa, no un detalle de este change, y se cotiza aparte.

### 9. El texto sale de una plantilla; la IA es opcional y humana

El borrador se arma siempre con una plantilla determinista sobre la ficha del vehículo. Quien revisa puede, si quiere, pedirle a la IA de la cuenta que reescriba ese texto antes de aprobar.

*Por qué no generar al encolar:* la IA del proyecto es BYO key por cuenta y opcional — `loadAiConfig` devuelve `null` cuando no hay fila o el switch maestro está apagado (`src/lib/ai/config.ts:24-38`). Si el borrador naciera generado, una cuenta sin key no tendría cola. Además el texto generado no se puede testear por igualdad, que es justo lo que piden los tests de composición.

*Por qué en la revisión y no en otro lado:* quien aprueba ya está mirando la publicación. Es el único momento en que un texto reescrito puede leerse antes de salir, y mantiene la regla de que nada automático toca el feed.

*Nota de implementación:* `ai_usage_log.mode` es hoy `'auto_reply' | 'draft'`. La reescritura necesita un valor nuevo, o reusar `'draft'` si se acepta que el reporte de consumo no los distinga.

### 10. Publicable significa exactamente `available`

Los estados son cuatro: `available`, `reserved`, `sold`, `hidden` (`src/lib/inventory/payload.ts:16-21`). Solo el primero admite publicación. Cualquier otro retira la pendiente y bloquea la aprobación.

*Por qué:* es la regla que el sistema ya aplica en los dos lugares donde un vehículo se expone hacia afuera. La vitrina filtra `status = 'available'` (`src/lib/showcase/data.ts:57`), y `syncVehicleKnowledge` borra el documento del knowledge base para *"otro status (sold/reserved/hidden)"* (`src/lib/inventory/knowledge-sync.ts:68-110`). Publicar un vehículo reservado llevaría a una ficha que ya no aparece en la vitrina.

Esto también corrige una imprecisión: la revalidación previa no comprueba "que no esté vendido", comprueba que esté disponible.

### 11. Un vehículo que reingresa genera un borrador nuevo, con su antecedente a la vista

Si un vehículo vuelve de `sold` a `available`, se prepara una publicación nueva, y la cola muestra que ese vehículo ya se publicó antes y cuándo.

*Por qué:* es el precedente del propio sistema — `syncVehicleKnowledge` recrea el documento del KB cuando el vehículo reingresa. Un auto que vuelve al inventario meses después es un hecho comercial nuevo y merece ofrecerse.

*Por qué con el antecedente visible:* republicar el mismo auto puede ser exactamente lo correcto o puede ser un descuido, y desde la cola no se distingue. Mostrar la fecha de la publicación anterior convierte eso en una decisión informada, en línea con todo el resto del diseño.

### 12. Las fotos se convierten a JPEG antes de publicar

Instagram acepta JPEG y nada más. El bucket `showcase-media` acepta `image/png`, `image/jpeg` e `image/webp` (migración 506, línea 23). El desajuste es real: un vehículo fotografiado bien pero subido en PNG hoy no sería publicable.

Antes de crear los contenedores, cada imagen no-JPEG se convierte y la copia se guarda en el bucket, que es de donde Meta la descarga.

*Alternativa descartada — filtrar las no-JPEG:* ahorra el paso de conversión, pero deja vehículos fuera de Instagram por una razón invisible para quien cargó las fotos. El motivo del descarte no tendría ninguna relación con lo que la persona ve.

*Alternativa descartada — exigir JPEG al subir:* resuelve el problema de raíz, pero toca el uploader, el bucket y las fotos ya cargadas. Es otro change; este no puede empezar por reescribir cómo entra el inventario.

### 13. La conexión usa Instagram Login, no Facebook Login

Meta ofrece dos caminos. Se toma *Instagram API with Instagram Login*, con los permisos `instagram_business_basic` e `instagram_business_content_publish`.

*Por qué:* no exige tener una página de Facebook vinculada, y son dos permisos en vez de cuatro. Menos que pedirle al cliente y menos superficie que Meta tiene que revisar — y la revisión es calendario ajeno, el bloqueante más largo de todo el change.

*Lo que esto corrige:* la propuesta daba por sentado que la cuenta debía estar vinculada a una página de Facebook. Con este camino no hace falta; sí sigue siendo obligatorio que sea una cuenta profesional.

*Lo que hay que tener presente:* `add-meta-multichannel` probablemente necesite Facebook Login para la mensajería. Si ambos avanzan, la misma cuenta de Instagram terminará conectada por dos caminos distintos. Se acepta a cambio de no atar este change al calendario de revisión del otro, que es más grande.

### 14. Aprueba `admin` o superior

La misma regla que ya rige conectar la cuenta, apoyada en `hasMinRole` (`src/lib/auth/roles.ts:44-49`) como cualquier otro control de rol del repositorio.

*Por qué no cualquier asesor:* un asesor carga inventario; publicar en el Instagram del negocio es intervenir su marca, que es el argumento por el que existe la cola.

*El costo, asumido:* si administración no entra seguido, la cola se estanca. Es el riesgo que este diseño ya reconoce, y la razón de que haga falta un indicador de pendientes visible.

## Risks / Trade-offs

- **Doble publicación** → Candado condicional más el identificador de Meta como prueba. Ante duda, no se republica.
- **Publicar un auto vendido** → Revalidación en el momento de publicar, no al encolar.
- **La cola se llena y nadie la mira** → Es un riesgo real de producto: una cola ignorada es trabajo manual con pasos extra. Conviene un indicador de pendientes visible y descarte fácil.
- **Fotos rotas al momento de publicar** → Se verifican las URLs antes de enviar a Meta; una publicación rechazada por imagen inaccesible queda como fallida con su motivo.
- **La conversión a JPEG falla o degrada la foto** → Es un paso nuevo entre la aprobación y el envío, y puede fallar por su cuenta. Un fallo de conversión es un fallo de contenido, no de credenciales, y debe decirlo así. La calidad de salida se fija en un solo lugar junto con el resto de lo que depende de Meta.
- **El token de Instagram caduca** → Los tokens de Meta expiran. Un fallo de autenticación debe distinguirse de un fallo de contenido: el primero se arregla reconectando la cuenta y el sistema debe decirlo así.
- **Cambios de política de Meta** → Permisos, topes y formatos los fija Meta. Todo lo que dependa de eso vive en un solo módulo.

## Migration Plan

1. Migración: tabla de conexión de Instagram por cuenta (token cifrado, siguiendo `whatsapp_config`) y tabla de la cola, con su campo de bloqueo. RLS con el patrón del repo.
2. Cliente de Graph API para publicación, aislado, al estilo de `meta-api.ts`.
3. Encolado del borrador al pasar a `available`, best-effort.
4. Pantalla de revisión: ver, editar texto, aprobar, descartar.
5. Publicación con candado: consulta del margen restante, revalidación previa, conversión de las imágenes a JPEG y registro del identificador devuelto.
6. Aviso de vehículo vendido con publicación viva.
7. Conexión y desconexión de la cuenta en Ajustes.

**Rollback:** todo es aditivo. Revertir el código deja las tablas huérfanas, las copias JPEG sueltas en el bucket y el inventario intacto. Lo único no reversible es lo ya publicado en Instagram, que vive fuera del sistema.

## Open Questions

Las siete preguntas que este design dejó abiertas se resolvieron el 2026-08-12 y viven arriba como decisiones: carrusel sin placa (8), texto de plantilla con IA opcional (9), publicable = `available` (10), reingreso con antecedente (11), conversión a JPEG (12), Instagram Login (13) y aprobación `admin+` (14). El tope quedó resuelto consultando a Meta en vez de decidir un número (6).

**Historias en vez de feed** se evaluó y se descartó para este change. Caducar en 24 horas resuelve solo el problema del auto vendido, pero llega únicamente a los seguidores actuales y no deja nada permanente — y sobre todo, vacía de sentido a la cola, la aprobación y el candado, que existen porque publicar es irreversible. Si más adelante interesa, es un change propio, no una variante de este.

Queda sin decidir, y no bloquea:

- **La placa de datos** como último elemento del carrusel. Diferida en la decisión 8 por ser una feature aparte; conviene revisarla después de ver publicaciones reales.
- **Si `ai_usage_log.mode` gana un valor propio** para la reescritura de texto, o reusa `'draft'`. Se define al implementar la decisión 9.
