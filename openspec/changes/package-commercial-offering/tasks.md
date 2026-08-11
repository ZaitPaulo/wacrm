## 1. Decisiones pendientes (bloquean lo demás)

- [ ] 1.1 Confirmar la razón social del proveedor — la propuesta dice "AISOFT", tomado del nombre de la carpeta del proyecto
- [ ] 1.2 Fijar los topes concretos de cada plan: usuarios, vehículos y consultas de IA por periodo
- [ ] 1.3 Definir la duración del periodo de gracia (sugerido: 15 días)
- [ ] 1.4 Decidir si la licencia única recibe actualizaciones sin soporte contratado
- [ ] 1.5 Decidir si el consumo de IA se incluye en el plan o se factura por separado (hoy la propuesta lo lista como costo de terceros, pero quien recibe la factura del proveedor es el operador)
- [ ] 1.6 Definir el piso de descuento — tras el ajuste del 40% el margen de negociación es estrecho

## 2. Migración de base de datos

- [ ] 2.1 Crear `supabase/migrations/509_subscription_plans.sql` idempotente, siguiendo el estilo del repo
- [ ] 2.2 Tabla de planes con sus topes declarados; un tope nulo significa "sin restricción", nunca cero
- [ ] 2.3 Columnas de plan, estado y vigencia en `accounts`
- [ ] 2.4 RLS: sólo `admin` o superior lee la información de plan de su cuenta
- [ ] 2.5 Ampliar el registro de consumo a usuarios, vehículos y mensajes, con el mismo criterio de cuenta y periodo que `ai_usage_log`
- [ ] 2.6 Sembrar los planes de los modelos vigentes y asignar a **todas las cuentas existentes un plan activo sin restricción**, para que nadie note el despliegue
- [ ] 2.7 Aplicar a la nube con `npx supabase db push --db-url "<cadena>?sslmode=require" --include-all` (lo corre el usuario) y verificar por introspección

## 3. Resolución de plan y estado

- [ ] 3.1 Extender el contexto de cuenta (`src/lib/auth/account.ts`) para resolver plan, topes y estado en el mismo viaje que ya hace
- [ ] 3.2 Ante dato ausente o error, tratar la cuenta como activa y registrar la anomalía
- [ ] 3.3 Helper de comprobación de topes, separado de `src/lib/rate-limit.ts` y con su propio tipo de error
- [ ] 3.4 Tests de la resolución: cuenta sin datos de suscripción, vencida, en gracia y suspendida

## 4. Aplicación de los topes

- [ ] 4.1 `POST /api/inventory` comprueba el tope de vehículos
- [ ] 4.2 Invitaciones comprueban el tope de usuarios
- [ ] 4.3 Rutas de IA comprueban el tope de consultas
- [ ] 4.4 Verificar que ninguna comprobación afecta rutas de lectura ni la recepción de mensajes entrantes
- [ ] 4.5 Mensajes de error que digan qué límite se alcanzó y cómo ampliarlo, distinguibles del error por exceso de peticiones

## 5. Ciclo de vida de la suscripción

- [ ] 5.1 Bloqueo de escritura con la cuenta suspendida, conservando lectura y exportación
- [ ] 5.2 La vitrina pública deja de publicarse mientras la cuenta está suspendida, sin revelar la causa al visitante
- [ ] 5.3 Reactivación inmediata al regularizar, conservando las direcciones de cada vehículo
- [ ] 5.4 Aviso dentro de la aplicación durante todo el periodo de gracia, visible para `admin` o superior
- [ ] 5.5 Verificar que la exportación funciona en los tres estados

## 6. Vista de plan y consumo

- [ ] 6.1 Sección en Ajustes con el plan vigente, sus topes y el consumo del periodo
- [ ] 6.2 Advertencia al aproximarse a un tope, antes de alcanzarlo
- [ ] 6.3 Ocultarla por completo a roles `agent` y `viewer`
- [ ] 6.4 Traducciones en `messages/{es,en,ko}.json`

## 7. Entrega para licencia única

- [ ] 7.1 Escribir `docs/self-hosting.md`: requisitos, variables de entorno, migraciones, primera cuenta y verificación
- [ ] 7.2 Ejecutar el procedimiento completo en una máquina limpia y corregir lo que falle
- [ ] 7.3 Revisar que el paquete de entrega no arrastre credenciales de desarrollo; sólo plantillas de ejemplo
- [ ] 7.4 Documentar el procedimiento de actualización de una instalación en uso, con respaldo previo
- [ ] 7.5 Revisar que `Dockerfile` y `docker-compose.yml` sigan vigentes tras los cambios de este change

## 8. Cierre comercial

- [ ] 8.1 Definir garantías y tiempos de respuesta, y agregarlos a la propuesta si el cliente los pide
- [ ] 8.2 Actualizar la propuesta publicada si cambian precios o alcance — el HTML fuente genera también el PDF, regenerar ambos
- [ ] 8.3 Evaluar cotizar aparte la fotografía del inventario: hoy está excluida y es lo que más pesa en la vitrina

## 9. Verificación

- [ ] 9.1 `pnpm typecheck` limpio
- [ ] 9.2 `pnpm lint` sin errores nuevos (el repo arrastra 2 preexistentes en `join/[token]/page.tsx`)
- [ ] 9.3 `pnpm test` sin fallos nuevos (5 preexistentes de locale en `currency.test.ts` y `date-utils.test.ts`)
- [ ] 9.4 Prueba manual: cuenta en el tope de vehículos sigue atendiendo conversaciones y editando su inventario
- [ ] 9.5 Prueba manual: cuenta suspendida conserva lectura y exportación, y su vitrina deja de publicarse
- [ ] 9.6 Prueba manual: al regularizar, todo vuelve sin pérdida de información
