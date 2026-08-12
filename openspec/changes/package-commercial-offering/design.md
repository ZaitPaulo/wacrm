## Context

Este documento cumple dos funciones: fija las decisiones técnicas de cómo se implementan planes y suscripciones, y **conserva el estado comercial** para que retomar la venta no dependa de la memoria de nadie.

El sistema hoy es multi-cuenta (migración 017) con cuatro roles jerárquicos, pero todas las cuentas son iguales entre sí. No hay plan, ni estado de pago, ni topes. El único consumo que se registra es el de IA, en `ai_usage_log`.

---

## Estado comercial (2026-08-11)

### Los tres modelos, valores vigentes

| Modelo | Entrada | Mensual | Total 36 meses |
|---|---|---|---|
| Suscripción *(recomendado)* | $4.900.000 | $890.000 | $36.940.000 |
| Licencia única, con soporte | $28.000.000 | $490.000 | $45.640.000 |
| Licencia única, sin soporte | $28.000.000 | — | $28.000.000 |
| Híbrido | $11.900.000 | $450.000 | $28.100.000 |

Valores en COP sin IVA. Se fijaron tras bajar un 40% la escala inicial: la primera versión partía de $1.490.000 mensuales y se ajustó por criterio comercial, no por cambio de alcance.

**No hay funciones recortadas entre modelos.** Los tres entregan el sistema completo; cambia cómo se paga y quién opera la infraestructura. Esa decisión simplifica el producto —no hay que construir diferenciación por plan— pero implica que el único eje de plan que queda es el **tamaño de la operación**, no el catálogo de funciones.

### Caso de negocio y sus supuestos

Perfil de referencia: compraventa mediana, 80 unidades en patio, 11 ventas al mes, ticket promedio $95.000.000, margen bruto 13% → utilidad bruta cercana a $136.000.000 mensuales.

Cuatro palancas, con beneficio estimado de ~$32.000.000 al mes:

1. **Rotación**: identificar el stock de más de 90 días (~$1.500.000.000 de capital típicamente inmovilizado).
2. **Leads**: recuperar una venta al mes ≈ $12.300.000 de margen. *Es la palanca que sostiene sola toda la inversión.*
3. **Decisión de compra**: margen real por marca en lugar de intuición.
4. **Tiempo del equipo**: ~90 horas al mes liberadas de responder lo mismo.

Los supuestos se declaran a la vista en la propuesta **a propósito**: la demo consiste en reemplazarlos por los números reales del cliente delante de él. Si el cálculo no se sostiene con sus cifras, es mejor saberlo antes de vender.

### Decisiones comerciales abiertas

- **Razón social del proveedor.** La propuesta dice "AISOFT", tomado del nombre de la carpeta del proyecto. Sin confirmar.
- **Garantías y tiempos de respuesta.** No se incluyeron por no comprometer algo que no se pueda sostener. Un cliente formal los va a pedir.
- **Política de descuentos.** Tras el ajuste del 40% el margen de negociación es estrecho. Falta decidir el piso.
- **Fotografía del inventario.** Queda excluida de la propuesta, pero es lo que más pesa en la vitrina. Podría venderse aparte.

---

---

## Inventario de dependencias para producción (verificado 2026-08-11)

Levantado del código, no de memoria: `.env.local.example` más todos los
`process.env` del árbol.

### Variables obligatorias

```
NEXT_PUBLIC_SUPABASE_URL          ┐
NEXT_PUBLIC_SUPABASE_ANON_KEY     ├─ Supabase
SUPABASE_SERVICE_ROLE_KEY         ┘
ENCRYPTION_KEY                    ─ propia; cifra los tokens de Meta
META_APP_SECRET                   ─ Meta; verifica la firma del webhook
```

### Variables opcionales

| Variable | Para qué |
|---|---|
| `META_APP_ID` | Subir cabeceras de plantillas de WhatsApp |
| `AUTOMATION_CRON_SECRET` | Proteger `/api/automations/cron` y `/api/flows/cron` |
| `NEXT_PUBLIC_SITE_URL` | Enlaces absolutos: vitrina, invitaciones, OpenRouter |
| `ALLOWED_INVITE_HOSTS` | Restringir a qué dominios apuntan las invitaciones |
| `NEXT_PUBLIC_APP_LOCALE` | Idioma por defecto |
| `AI_REQUEST_TIMEOUT_MS`, `AI_CONTEXT_MESSAGE_LIMIT`, `AI_REPLY_DEBOUNCE_MS` | Ajuste fino del asistente |
| `ALLOWED_DEV_ORIGINS`, `WHATSAPP_TEMPLATES_DRY_RUN` | Sólo desarrollo |

**Las claves de los proveedores de IA NO son variables de entorno.** Se
guardan cifradas en la base, por cuenta, y las carga el propio cliente
desde la interfaz. Eso importa para el modelo de licencia: cada
instalación usa su propia clave sin que nadie toque el servidor.

### Qué se puede autohospedar y qué no

| Dependencia | Self-host | Nota |
|---|---|---|
| Aplicación Next.js | Sí | `Dockerfile` + `output: standalone` ya existen |
| Supabase | Sí | Open source; son varios contenedores, no uno |
| Proveedores de IA | Opcional | OpenAI, Anthropic, OpenRouter, Gemini. Sin clave el resto funciona |
| **WhatsApp Cloud API** | **No** | Servicio de Meta. La API On-Premises fue descontinuada |

**Meta es el único candado real y no tiene alternativa.** Conviene decirlo
tal cual al vender una licencia: el sistema es del cliente y corre en su
servidor, pero el canal de WhatsApp es de Meta y siempre lo será. Ningún
competidor puede ofrecer otra cosa.

### Tres topologías posibles

- **A — Supabase gestionado + app propia.** El cliente paga Supabase y la
  app corre donde sea. Funciona hoy sin construir nada.
- **B — Todo en el servidor del cliente.** Cero dependencias fuera de
  Meta, pero alguien opera respaldos, actualizaciones y disco.
- **C — Todo en infraestructura del proveedor, multi-cliente.** Es el
  modelo de suscripción: una instalación y cada compraventa es una
  cuenta. El aislamiento ya lo da la RLS.

**Brecha concreta para la topología B:** el `docker-compose.yml` actual
levanta **un solo servicio, la app**, y da por hecho que Supabase vive en
otra parte. Una instalación completa necesita además el stack de
Supabase, que hoy no está en el repositorio.

---

## Goals / Non-Goals

**Goals**
- Que una cuenta sepa qué contrató y hasta dónde puede usar el sistema.
- Que dejar de pagar tenga una consecuencia definida y predecible, sin que el cliente pierda sus datos.
- Poder instalar el sistema en infraestructura ajena de forma repetible.
- Conservar el contexto comercial dentro del repositorio.

**Non-Goals**
- Cobrar automáticamente. La facturación sigue siendo manual mientras haya pocos clientes.
- Diferenciar funciones por plan. Los tres modelos entregan lo mismo.
- Registro autoservicio.

## Decisions

### 1. El plan vive en la cuenta, no en el usuario

Una tabla de planes (definición) y una referencia desde `accounts` (qué plan tiene, en qué estado, hasta cuándo). Los límites se resuelven desde el contexto de cuenta que ya construye `getCurrentAccount()`, que es el único punto por el que pasan todas las rutas autenticadas.

*Alternativa descartada:* plan por usuario. El negocio contrata como empresa, no por asiento, y el modelo multi-cuenta ya trata la cuenta como la unidad de tenencia.

### 2. Los topes se comprueban al escribir, no al leer

Un tope alcanzado impide **crear** (un vehículo más, un usuario más), nunca **consultar** lo existente. Un cliente que llegó a su límite sigue viendo su inventario completo y sigue atendiendo a sus clientes.

Esto también acota el trabajo: los puntos de control son las rutas de escritura ya existentes, no cada consulta del sistema.

### 3. Vencer no es apagar

Tres estados con degradación gradual:

```
activa      → todo funciona
gracia      → todo funciona + aviso visible en la aplicación
suspendida  → sólo lectura y exportación; la vitrina pública deja de publicarse
```

Nunca hay un cuarto estado que borre datos. La exportación funciona incluso suspendido, y eso se declara como requisito para que no dependa del criterio de quien implemente.

*Por qué gradual:* una compraventa que no puede responderle a un cliente pierde una venta de decenas de millones. El daño de bloquear por error es órdenes de magnitud mayor que el de cobrar tarde.

### 4. Límite comercial y límite técnico son mecanismos distintos

`src/lib/rate-limit.ts` seguirá protegiendo contra ráfagas y devolviendo 429. Los topes de plan son otra cosa: responden un error propio, con un mensaje que explica qué límite se alcanzó y qué hacer. Mezclarlos haría que un cliente que llegó a su tope viera "demasiadas peticiones", que es a la vez falso y desconcertante.

### 5. La licencia única se entrega como despliegue verificado, no como carpeta de código

Ya existen `Dockerfile`, `docker-compose.yml` y `docs/docker.md`. Falta la parte que convierte eso en algo entregable: un procedimiento probado desde cero en una máquina limpia, con generación de credenciales propias del cliente y sin arrastrar ninguna de desarrollo.

*Riesgo asumido:* el proyecto es MIT y self-hostable, así que el cliente de licencia única podría seguir por su cuenta. Es inherente al modelo y el precio ya lo refleja; el valor recurrente está en el soporte y las actualizaciones, no en retener el código.

## Risks / Trade-offs

- **Bloquear a quien sí pagó** → El estado se resuelve una vez por petición en el contexto de cuenta; ante cualquier ambigüedad (dato faltante, fecha nula) se asume activa. Es preferible cobrar tarde a detener un negocio.
- **La vitrina cae al suspender y el cliente pierde ventas sin entender por qué** → La suspensión debe avisarse dentro de la aplicación durante todo el periodo de gracia, no aparecer de golpe.
- **Sin funciones diferenciadas, el plan sólo puede escalar por tamaño** → Si más adelante se quiere un plan barato de entrada, habrá que decidir qué se recorta, y eso hoy no está pensado.
- **Los límites se vuelven una tabla que nadie mantiene** → Los valores por defecto deben vivir en la definición del plan, no repartidos por el código.

## Migration Plan

1. Migración `509_subscription_plans.sql`: tabla de planes con sus topes, columnas de plan y estado en `accounts`, ampliación del registro de consumo. Idempotente, mismo estilo que la 508.
2. Sembrar los planes correspondientes a los modelos vigentes y asignar a **todas las cuentas existentes un plan activo sin restricción**, para que nadie note el cambio el día del despliegue.
3. Resolución de plan y estado en el contexto de cuenta.
4. Comprobación de topes en las rutas de escritura.
5. Vista de plan y consumo en Ajustes.
6. Guía de instalación y prueba en máquina limpia.

**Rollback:** todo es aditivo. Revertir el código deja las tablas huérfanas sin afectar la operación, porque el estado por defecto es "activa sin restricción".

## Open Questions

- **¿Qué topes concretos lleva cada plan?** El perfil de referencia son 80 unidades y 3-5 usuarios, pero no se ha fijado el número que dispara el salto de plan.
- **¿Cuánto dura el periodo de gracia?** Sugerido 15 días, sin confirmar.
- **¿La licencia única recibe actualizaciones sin soporte contratado?** Hoy la propuesta no lo aclara y es una pregunta que el cliente hará.
- **¿El consumo de IA se factura aparte o se incluye en el plan?** La propuesta lo lista como costo de terceros pagado por consumo, pero quien recibe la factura del proveedor de IA es el operador, no el cliente.
