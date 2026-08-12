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

### 6. El tope diario de Meta se respeta antes de intentar

Meta limita cuántas publicaciones acepta por día. El sistema lo conoce, lo muestra en la cola y no intenta publicar cuando ya no queda margen — igual que la ventana de respuesta en mensajería, se impide antes en vez de descubrirlo por el rechazo.

**El número concreto no se fija en esta spec:** lo define Meta y cambia. Va en un solo lugar del código, leído de su documentación vigente al implementar.

### 7. Las fotos se sirven desde el bucket público

Meta descarga la imagen desde una URL accesible. `showcase-media` ya es público (migración 506), así que no hace falta infraestructura nueva.

*Consecuencia a tener presente:* un vehículo cuyas fotos vengan de un dominio externo depende de que ese dominio siga sirviéndolas. La validación previa a publicar debe comprobar que las URLs responden.

## Risks / Trade-offs

- **Doble publicación** → Candado condicional más el identificador de Meta como prueba. Ante duda, no se republica.
- **Publicar un auto vendido** → Revalidación en el momento de publicar, no al encolar.
- **La cola se llena y nadie la mira** → Es un riesgo real de producto: una cola ignorada es trabajo manual con pasos extra. Conviene un indicador de pendientes visible y descarte fácil.
- **Fotos rotas al momento de publicar** → Se verifican las URLs antes de enviar a Meta; una publicación rechazada por imagen inaccesible queda como fallida con su motivo.
- **El token de Instagram caduca** → Los tokens de Meta expiran. Un fallo de autenticación debe distinguirse de un fallo de contenido: el primero se arregla reconectando la cuenta y el sistema debe decirlo así.
- **Cambios de política de Meta** → Permisos, topes y formatos los fija Meta. Todo lo que dependa de eso vive en un solo módulo.

## Migration Plan

1. Migración: tabla de conexión de Instagram por cuenta (token cifrado, siguiendo `whatsapp_config`) y tabla de la cola, con su campo de bloqueo. RLS con el patrón del repo.
2. Cliente de Graph API para publicación, aislado, al estilo de `meta-api.ts`.
3. Encolado del borrador al pasar a `available`, best-effort.
4. Pantalla de revisión: ver, editar texto, aprobar, descartar.
5. Publicación con candado, revalidación previa y registro del identificador devuelto.
6. Aviso de vehículo vendido con publicación viva.
7. Conexión y desconexión de la cuenta en Ajustes.

**Rollback:** todo es aditivo. Revertir el código deja las tablas huérfanas y el inventario intacto. Lo único no reversible es lo ya publicado en Instagram, que vive fuera del sistema.

## Open Questions

- **¿Carrusel o imagen única?** Una foto suelta rinde poco para vender un auto; lo habitual es carrusel con exterior, interior y una placa de datos. La placa implica generar una imagen, que es trabajo aparte.
- **¿Quién aprueba?** ¿Cualquier asesor o solo administración? Es la marca del negocio; probablemente admin o superior, pero no está decidido.
- **¿El texto se arma con IA?** El sistema ya tiene integración con modelos. Un texto generado a partir de la ficha sería mejor que una plantilla fija, pero agrega costo por publicación y otro punto de revisión.
- **¿Historias en vez de feed?** Para inventario que rota, caducar en 24 horas resuelve solo el problema del auto vendido. Vale evaluarlo antes de construir el feed.
- **¿Qué pasa con un vehículo que se reingresa?** Si vuelve de `sold` a `available`, ¿se ofrece publicarlo de nuevo o se respeta que ya tuvo su publicación?
