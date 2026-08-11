## Why

El producto está listo para mostrarse —tablero de compraventa, vitrina, inventario con márgenes, IA sobre el inventario real— y ya existe una propuesta comercial con tres modelos de contratación y precios definidos. Lo que no existe es **el software que esos modelos dan por hecho**.

De las 41 tablas del esquema no hay ninguna de planes, suscripciones, límites ni facturación. Hoy toda cuenta es ilimitada e indistinguible de otra: no hay forma de saber si una cuenta pagó, qué contrató, ni qué pasa si deja de pagar. Vender una suscripción contra eso significa administrarla a mano en una hoja de cálculo y confiar en la memoria.

Lo que sí existe y sirve de base: `ai_usage_log` (consumo de IA por cuenta), `src/lib/rate-limit.ts` (límites técnicos por ráfaga, no comerciales), `Dockerfile` + `docker-compose.yml` + `docs/docker.md` (despliegue), y el modelo multi-cuenta de la migración 017.

El segundo motivo es de memoria: las decisiones comerciales —los tres modelos, los precios, el caso de negocio y lo que quedó sin resolver— viven hoy en un documento publicado fuera del repositorio. Quedan aquí para que retomar el tema no dependa de reconstruirlas de nuevo.

## What Changes

**Capacidades de software nuevas**

- **Planes con límites por cuenta.** Cada cuenta queda asociada a un plan que define cuántos usuarios, vehículos y consultas de IA puede usar. Hoy no hay ningún tope.
- **Ciclo de vida de la suscripción.** Estado explícito (activa, en periodo de gracia, suspendida) y una degradación definida: qué se bloquea y qué se conserva cuando una cuenta deja de pagar. La regla de fondo es que **el cliente nunca pierde acceso a sus datos**, aunque pierda la capacidad de operar.
- **Medición de consumo comercial.** Extender lo que ya hace `ai_usage_log` a las magnitudes que se facturan: unidades en inventario, usuarios activos, mensajes enviados.
- **Entrega para licencia única.** El modelo de licencia implica instalar en infraestructura del cliente. Hay `Dockerfile` y `docker-compose.yml`, pero no un procedimiento verificado de instalación desde cero ni una forma de entregar el sistema sin las credenciales de desarrollo.

**Registro comercial** (no es software, se documenta en `design.md`)

- Los tres modelos con sus valores vigentes.
- El caso de negocio y sus supuestos.
- Las decisiones que siguen abiertas: razón social del proveedor, garantías y tiempos de respuesta, política de descuentos.

**Fuera de alcance en este change**

- Pasarela de pagos. Con pocos clientes la facturación es manual; automatizar el cobro es un problema posterior y con proveedor propio.
- Autoservicio de registro. Hoy cada cliente se da de alta en la implementación acompañada.
- Prorrateo, cambios de plan a mitad de periodo y notas crédito.

## Capabilities

### New Capabilities
- `subscription-plans`: qué define un plan, qué límites aplica sobre cada cuenta y qué ocurre exactamente al alcanzarlos.
- `subscription-lifecycle`: los estados por los que pasa una suscripción, qué se degrada en cada uno y la garantía de que los datos del cliente siguen siendo suyos y exportables.
- `commercial-metering`: qué magnitudes se miden por cuenta para poder facturar y para que el cliente vea su propio consumo antes de recibir la factura.
- `license-packaging`: qué se entrega y cómo se verifica una instalación en infraestructura del cliente bajo el modelo de licencia única.

### Modified Capabilities
<!-- Ninguna. Las capacidades documentadas (`ai-reply-gating`, `flow-handoff-routing`, `spanish-locale`) no cambian sus requisitos. -->

## Impact

**Base de datos**
- Migración nueva en el rango 509+ (la última es `508_vehicle_economics.sql`).
- Tablas de planes y suscripción por cuenta; ampliación del registro de consumo. Nada se elimina.

**Código previsiblemente afectado**
- `src/lib/auth/account.ts` — el contexto de cuenta pasa a resolver también plan y estado.
- `src/lib/auth/roles.ts` — los límites son ortogonales al rol: un `owner` de una cuenta suspendida puede menos que un `agent` de una activa.
- Rutas de escritura de `/api/inventory`, `/api/whatsapp/send` y `/api/ai/*` — donde se comprueban los topes.
- `src/app/(dashboard)/settings/` — el cliente debe poder ver su plan y su consumo.
- `docs/` — guía de instalación para el modelo de licencia.

**Riesgo principal**
- **Bloquear a un cliente que sí pagó.** Un fallo en el control de límites o de estado deja a un negocio sin poder vender. Cualquier duda debe resolverse a favor de dejar operar y avisar, nunca de bloquear.
- **Confundir límite técnico con límite comercial.** `rate-limit.ts` protege el servicio de ráfagas; los topes de plan son otra cosa y no deben mezclarse en el mismo mecanismo ni devolver el mismo error.

**Referencia comercial**
- Propuesta publicada: <https://claude.ai/code/artifact/91eea357-1d52-4a3f-b220-e661b44e37dd>
- PDF generado: `Propuesta-CRM-Compraventa-AISoft.pdf`
