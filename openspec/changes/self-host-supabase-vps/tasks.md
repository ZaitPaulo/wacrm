## 0. Preparación del servidor

Trabajo sobre el VPS, no sobre el repo. Procedimiento completo en `preparacion-del-vps.md`.

- [x] 0.1 Contratar el VPS — Contabo Cloud VPS Plus 6: 6 vCPU AMD EPYC / 12 GB / 300 GB NVMe, Ubuntu 24.04 LTS, US East (Nueva York), IPv4 dedicada, 5 snapshots
- [ ] 0.2 Crear el usuario de trabajo con sudo y endurecer SSH (sin root directo, solo clave), verificando el acceso antes de cerrar la sesión original
- [ ] 0.3 Actualizar el sistema, fijar zona horaria, confirmar sincronización de reloj y activar actualizaciones de seguridad automáticas
- [ ] 0.4 Configurar 4 GB de swap con `vm.swappiness=10`
- [ ] 0.5 Activar UFW dejando abiertos solo SSH, 80 y 443
- [ ] 0.6 Instalar Docker Engine y el plugin Compose desde el repositorio oficial, y configurar la rotación de logs del demonio
- [ ] 0.7 Crear los registros DNS `crm` y `supabase`, y verificar la propagación con `dig` antes de tocar el proxy
- [ ] 0.8 Confirmar que nada más ocupa los puertos 80 y 443 en el host
- [ ] 0.9 Clonar el repositorio en `/opt/crm` con el usuario de trabajo
- [ ] 0.10 Reunir credenciales: acceso al DNS, correo para Let's Encrypt, Meta App ID y App Secret, credenciales de WhatsApp Business
- [ ] 0.11 Pasar la verificación final del runbook antes de continuar

## 1. Estructura y stack de Supabase

- [ ] 1.1 Crear `deploy/` con `README.md` que explique la separación entre el compose de upstream y el overlay propio
- [ ] 1.2 Vendorizar en `deploy/supabase/docker-compose.yml` el compose oficial de `supabase/supabase@docker`, sin modificar, anotando el commit de origen
- [ ] 1.3 Escribir `deploy/supabase/docker-compose.override.yml`: apagar `functions` y `supavisor`, fijar `storage` al backend `file` sobre volumen nombrado, quitar la publicación del puerto 8000 al host y unir todo a la red externa compartida
- [ ] 1.4 Fijar todas las imágenes a versiones explícitas y dejar la tabla de versiones en el README de `deploy/`
- [ ] 1.5 Levantar el stack en local (o en un VPS de prueba) y verificar que `db`, `api-gw`, `auth`, `rest`, `realtime`, `storage` y `meta` quedan sanos y que ningún contenedor reinicia en bucle

## 2. Secretos y configuración

- [ ] 2.1 Escribir `scripts/generate-secrets.sh`: contraseña de Postgres, `JWT_SECRET`, `ANON_KEY` y `SERVICE_ROLE_KEY` firmadas con ese secreto, `ENCRYPTION_KEY` de 64 hex, `AUTOMATION_CRON_SECRET`, credenciales de Studio y demás claves internas del stack
- [ ] 2.2 Crear `deploy/.env.example` con todo lo que consumen el stack y el app, comentado y agrupado por servicio
- [ ] 2.3 Añadir a `.env.local.example` la sección de self-host, señalando qué cambia respecto al despliegue contra la nube
- [ ] 2.4 Escribir `scripts/preflight.sh`: verificar que no queden valores de plantilla sin reemplazar, que `ENCRYPTION_KEY` tenga 64 caracteres hexadecimales, que `AUTOMATION_CRON_SECRET` esté definido y que las claves `anon`/`service_role` validen contra `JWT_SECRET`
- [ ] 2.5 Verificar que `deploy/.env` y cualquier archivo de secretos estén cubiertos por `.gitignore`

## 3. Base de datos y migraciones

- [ ] 3.1 Escribir `scripts/bootstrap-db.sh`: crear `supabase_migrations.schema_migrations` si falta y crear la publicación `supabase_realtime` de forma idempotente
- [ ] 3.2 Escribir `scripts/apply-migrations.sh`: recorrer `supabase/migrations/*.sql` en orden numérico, ejecutar cada una en una transacción con `psql` dentro del contenedor `db`, registrar la versión y omitir las ya aplicadas
- [ ] 3.3 Verificar el comportamiento ante fallo: introducir una migración inválida a propósito y comprobar que revierte, no se registra y detiene el proceso informando cuál falló
- [ ] 3.4 Aplicar las 53 migraciones sobre base limpia y confirmar que las extensiones `uuid-ossp` y `vector` quedan creadas
- [ ] 3.5 Verificar que la publicación `supabase_realtime` incluye `messages`, `conversations`, `message_reactions`, `flow_runs`, `member_presence` y `notifications`
- [ ] 3.6 Verificar que existen los 5 buckets: `avatars`, `flow-media`, `chat-media`, `contact-documents` y `showcase-media`
- [ ] 3.7 Confirmar que reejecutar el script no aplica nada y deja el esquema intacto

## 4. App, proxy y exposición pública

- [ ] 4.1 Ajustar el `docker-compose.yml` raíz para unirse a la red externa del stack y dejar de publicar el puerto al host (el proxy se encarga)
- [ ] 4.2 Escribir `deploy/Caddyfile`: `crm.<dominio>` hacia el app, `supabase.<dominio>` hacia el gateway, y Studio protegido con Basic Auth
- [ ] 4.3 Añadir el servicio del proxy al compose, con volúmenes persistentes para certificados y datos de Caddy
- [ ] 4.4 Documentar los registros DNS necesarios y las reglas de firewall (solo 22/80/443 abiertos)
- [ ] 4.5 Construir la imagen del app en el servidor con los `NEXT_PUBLIC_*` definitivos y levantarla
- [ ] 4.6 Verificar TLS válido en ambos hosts desde una red externa
- [ ] 4.7 Verificar que Postgres no es alcanzable desde una IP externa
- [ ] 4.8 Verificar que Studio devuelve 401 sin credenciales
- [ ] 4.9 Corregir la CSP de `next.config.ts:54,58`, que fija `https://*.supabase.co` y `wss://*.supabase.co` en `media-src` y `connect-src`: derivar los orígenes de `NEXT_PUBLIC_SUPABASE_URL` en vez de codificar el dominio de la nube
- [ ] 4.10 Confirmar en la consola del navegador que no quedan violaciones de CSP tras el cambio

## 5. Verificación funcional

- [ ] 5.1 Crear el primer usuario y validar el inicio de sesión y la carga del panel
- [ ] 5.2 Subir un avatar y una foto de vehículo, y comprobar que su URL pública responde 200 desde fuera del servidor con certificado válido
- [ ] 5.3 Validar Realtime: insertar una fila en `messages` y confirmar que aparece en la bandeja abierta sin recargar
- [ ] 5.4 Reiniciar el stack completo y confirmar que los archivos subidos siguen descargándose
- [ ] 5.5 Reiniciar el servidor y confirmar que todo vuelve solo, sin ejecutar comandos

## 6. Tareas programadas

- [ ] 6.1 Añadir al compose el contenedor de cron que invoca `/api/automations/cron` y `/api/flows/cron` por la red interna con la cabecera `x-cron-secret`
- [ ] 6.2 Definir y documentar la frecuencia de cada ruta
- [ ] 6.3 Verificar de punta a punta que una automatización con paso Wait avanza sola al cumplirse la espera
- [ ] 6.4 Comprobar que las rutas de cron no quedan publicadas en el proxy

## 7. Respaldo y restauración

- [ ] 7.1 Escribir `scripts/backup.sh`: `pg_dump` de la base más copia del volumen de Storage, con nombre fechado
- [ ] 7.2 Implementar la política de retención y dejar el valor por defecto documentado
- [ ] 7.3 Hacer que un fallo del respaldo quede registrado de forma visible y no se reporte como exitoso
- [ ] 7.4 Programar el respaldo diario dentro del compose
- [ ] 7.5 Escribir `scripts/restore.sh`
- [ ] 7.6 **Ejecutar la restauración de verdad** sobre un stack vacío y verificar login, conversaciones y descarga de archivos. Este paso no se salta ni se da por hecho

## 8. Documentación

- [ ] 8.1 Escribir `docs/self-hosting.md`: requisitos del servidor, instalación desde cero, arquitectura de los dos subdominios y cuadro de diagnóstico de fallos frecuentes
- [ ] 8.2 Reescribir `docs/docker.md`, que hoy afirma que Supabase es externo y que no se incluye contenedor de base de datos
- [ ] 8.3 Documentar el procedimiento de actualización del stack, con respaldo previo obligatorio
- [ ] 8.4 Documentar la rotación de secretos, advirtiendo que rotar `ENCRYPTION_KEY` obliga a reconectar WhatsApp en cada cuenta
- [ ] 8.5 Documentar la limitación conocida del reseteo de contraseña sin SMTP, con el procedimiento manual desde Studio
- [ ] 8.6 Advertir en negrita que cambiar cualquier `NEXT_PUBLIC_*` exige reconstruir la imagen, no reiniciarla
- [ ] 8.7 Actualizar el README con un puntero al despliegue autoalojado

## 9. Corte de producción

- [ ] 9.1 Repasar la lista de verificación completa sobre el VPS definitivo
- [ ] 9.2 Reapuntar el webhook de Meta a `https://crm.<dominio>/api/whatsapp/webhook` y superar la verificación
- [ ] 9.3 Confirmar con un mensaje real de WhatsApp entrante que llega a la bandeja
- [ ] 9.4 Verificar el envío saliente y la recepción de estados de entrega
- [ ] 9.5 Guardar fuera del servidor una copia de `deploy/.env` y `.env.local`, y dejar registrado dónde quedó
