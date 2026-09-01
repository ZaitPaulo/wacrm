# Conectar Instagram y Facebook

El CRM prepara una publicación por cada vehículo que pasa a **disponible** y la
deja esperando en **Publicaciones**. Nada sale hasta que alguien la aprueba ahí.

Cada red se conecta **por su lado**, en Ajustes. Son dos conexiones distintas:
conectar una no conecta la otra, y desconectar una no afecta a la otra.

> **Lo primero, porque es lo que más tarda:** publicar en una página de Facebook
> exige permisos que **Meta tiene que revisar y aprobar**. Esa revisión no
> depende de nosotros y puede llevar días. Conviene empezarla antes que
> cualquier otra cosa. Instagram ya está aprobado y no hace falta repetirlo.

---

## Antes de empezar

| | Instagram | Facebook |
|---|---|---|
| Qué se conecta | La cuenta profesional | Una página del negocio |
| Quién tiene que ser | Dueño de la cuenta | **Administrador** de la página |
| Permisos de Meta | Ya aprobados | **Requieren App Review** |
| Tipo de cuenta | Profesional (no personal) | Cualquiera, pero con página |

Para Facebook, verifica primero que tu usuario de Meta figure como
**administrador** de la página del negocio. Si figura solo como editor o
moderador, la página no va a aparecer en la lista al conectar.

---

## Conectar Instagram

Ya está documentado paso a paso **dentro del CRM**: entra a
**Ajustes → Instagram** y sigue la columna de la derecha. Son tres pasos en el
panel de desarrolladores de Meta y terminan con un token que se pega en el CRM.

El token de Instagram **dura 60 días**. Cuando caduca, publicar falla con un
aviso de credenciales que nombra a Instagram: hay que generar uno nuevo y volver
a conectar. No afecta a Facebook.

---

## Conectar Facebook

Las instrucciones completas están en **Ajustes → Facebook**, en la columna de la
derecha. Lo que conviene saber de antemano:

**1. No hace falta una app nueva.** Se usa la misma app de Meta que ya está
configurada para Instagram; solo hay que agregarle el producto *Facebook Login*.

**2. Hay que pedir tres permisos y esperar la aprobación.** En *App review* se
solicitan `pages_show_list`, `pages_read_engagement` y `pages_manage_posts`.
Hasta que Meta los apruebe, solo funcionan con la página del propio
desarrollador — sirve para probar, no para publicar en la página real.

**3. La conexión es de dos pasos, a propósito.** Primero se pega el token y el
CRM muestra las páginas que administras; después eliges una y recién ahí se
guarda. No elegimos por ti: publicar en la página equivocada lo ven los clientes
del negocio y no se deshace.

**4. Guardamos el token de la página, no el tuyo.** Es lo que hace falta para
publicar ahí, y por eso el segundo paso vuelve a hablar con Meta en lugar de
confiar en lo que viajó al navegador.

A diferencia de Instagram, el token de una página **no suele caducar** mientras
sigas siendo administrador y el permiso siga concedido.

---

## Cómo queda la cola con las dos redes conectadas

**Cada vehículo genera dos publicaciones, una por red.** No es un error ni una
duplicación: son dos decisiones distintas sobre dos destinos distintos.

- Cada tarjeta dice **a qué red va** y a qué cuenta o página exactamente.
- Aprobar la de Instagram **no** publica en Facebook, y al revés.
- Si una sale y la otra falla, la cola muestra los dos estados por separado. No
  se colapsan en un único "publicado".
- Con las dos redes conectadas puedes **filtrar por red** arriba de la lista.

**El tope solo aparece en Instagram.** Instagram limita cuántas publicaciones
admite por periodo y nos informa cuántas quedan; Facebook no publica un tope
equivalente, así que para esa red no mostramos ninguno en lugar de inventar un
número que frenaría aprobaciones sin motivo.

---

## Qué hacer cuando algo falla

Todos los avisos **nombran la red**. Es deliberado: con dos conexiones activas,
un mensaje que dijera solo "la cuenta" te haría reconectar la que estaba
funcionando.

| Lo que ves | Qué pasó | Dónde se arregla |
|---|---|---|
| *"X rechazó las credenciales"* | El token de esa red caducó o perdió permisos | Ajustes → esa red, reconectar |
| *"X rechazó la publicación: …"* | Un problema con las fotos o el texto | En la ficha del vehículo |
| *"Se perdió la respuesta de X"* | No sabemos si salió o no | **Míralo en la red antes de reintentar** |
| *"Se alcanzó el tope de X"* | Solo Instagram. La pendiente sigue ahí | Esperar al periodo siguiente |
| *"No hay … conectada"* | Falta conectar esa red | Ajustes → esa red |

Sobre el tercer caso: cuando el sistema **no puede saber** si la publicación
salió, la deja marcada para revisión manual y **no reintenta solo**. Es a
propósito. Una publicación no se deshace —quien la vio, la vio, y los avisos ya
salieron—, así que reintentar a ciegas podría duplicarla. Abre la red, fíjate si
está, y recién entonces decide.

---

## Lo que el sistema nunca hace

- **No publica solo.** No hay tarea programada ni automatización que llegue a
  publicar; siempre hay una persona aprobando.
- **No borra de la red.** Cuando se vende un vehículo con una publicación viva,
  la cola lo señala y nombra la red, pero la publicación sigue en pie. Qué hacer
  con ella —dejarla como prueba social o retirarla a mano— es decisión del
  negocio.
- **No republica lo que ya salió.** Si un vehículo reingresa al inventario se
  prepara una publicación nueva, y la cola avisa que ese auto ya se publicó
  antes en esa red, con la fecha, para que decidas con el dato a la vista.
