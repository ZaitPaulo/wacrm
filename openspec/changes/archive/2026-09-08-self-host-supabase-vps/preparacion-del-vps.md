# Preparación del VPS

Todo lo que hay que dejar listo **antes** de levantar Supabase y el CRM. Al terminar esta guía el servidor no tiene nada del proyecto instalado todavía: tiene un sistema endurecido, Docker funcionando, el firewall cerrado y el DNS resolviendo. Ese es exactamente el punto de partida que asume `tasks.md`.

Referencia: Ubuntu Server **24.04 LTS**. En Debian 12 los comandos son casi idénticos; se señalan las diferencias donde importan.

---

## 0. Qué pedirle al proveedor

**Contratado**: Contabo **Cloud VPS Plus 6** — 6 vCPU AMD EPYC, 12 GB RAM, 300 GB NVMe, Ubuntu 24.04 LTS, US East (Nueva York), 5 snapshots.

| Recurso | Mínimo real | Contratado | Por qué |
|---|---|---|---|
| vCPU | 4 | 6 (AMD EPYC) | El stack son ~10 contenedores; Postgres y Realtime compiten por CPU |
| RAM | 8 GB | 12 GB | Con 8 GB el `npm run build` de Next.js solo sobrevive gracias al swap |
| Disco | 80 GB NVMe | 300 GB NVMe | Imágenes Docker (~6 GB), base, fotos de vehículos, respaldos locales |
| SO | Ubuntu 24.04 LTS | Ubuntu 24.04 LTS | Soporte hasta 2029 y es donde Docker publica paquetes primero |
| IPv4 | Dedicada | 1 dedicada | Meta necesita alcanzar el webhook; una IP compartida no sirve |
| Snapshots | Activados | 5 | Segunda red de seguridad, independiente de nuestros respaldos |

**NVMe, no SSD.** Postgres se limita por IOPS y latencia de disco, no por capacidad: cada `fsync` del WAL espera al disco. En Contabo el tipo de disco no es una opción del configurador sino una **familia de producto distinta** ("Performance" frente a "Core"), y cambiarlo después de comprar destruye los datos — se decide al ordenar o no se decide.

**Ubicación**: elige la región más cercana a tus usuarios, no a Meta. La latencia que se nota es la del navegador contra el servidor; las llamadas a Graph API son de servidor a servidor y toleran bastante más.

Para Colombia lo ideal sería Miami (~40-60 ms desde Bogotá), pero **Contabo no tiene ningún datacenter en Latinoamérica**: sus regiones son la UE, Reino Unido, tres en EE.UU. (Nueva York, St. Louis, Seattle) y cuatro en Asia-Pacífico. Se eligió **US East (Nueva York)**, que ronda los 70-90 ms. La diferencia no se nota en un CRM interno, y evitarla habría costado unos $385 al año en un proveedor con presencia en Miami.

Un detalle contraintuitivo por si alguien reabre esto: **São Paulo no es mejor que Miami para Colombia**, pese a estar en el mismo continente. El tráfico entre países latinoamericanos casi siempre se enruta por Miami, así que Bogotá → São Paulo suele medir más que Bogotá → Miami.

**Pide la imagen limpia**, sin panel de control preinstalado. cPanel, Plesk o similares se quedan con los puertos 80 y 443, que es justo lo que necesita el reverse proxy.

---

## 1. Primer acceso y usuario de trabajo

Entra como root con la clave o contraseña que te dio el proveedor:

```bash
ssh root@TU_IP
```

Crea un usuario sin privilegios para operar el sistema. Trabajar como root a diario convierte cualquier error de tipeo en un incidente:

```bash
adduser crm
usermod -aG sudo crm
rsync --archive --chown=crm:crm ~/.ssh /home/crm
```

El `rsync` copia tu clave SSH autorizada al usuario nuevo. Sin ese paso, el siguiente bloque te deja fuera del servidor.

**Antes de continuar, abre una segunda terminal** y comprueba que entras como el usuario nuevo:

```bash
ssh crm@TU_IP
sudo whoami   # debe responder: root
```

Deja esa sesión abierta hasta terminar el paso 2. Es tu salida de emergencia.

---

## 2. Endurecer el acceso SSH

Solo con clave, sin root directo:

```bash
sudo tee /etc/ssh/sshd_config.d/01-hardening.conf > /dev/null <<'EOF'
PermitRootLogin no
PasswordAuthentication no
PubkeyAuthentication yes
KbdInteractiveAuthentication no
X11Forwarding no
MaxAuthTries 3
EOF

sudo sshd -t && sudo systemctl restart ssh
```

El `sshd -t` valida la sintaxis antes de reiniciar. Sin él, un error de configuración deja el servicio caído y el servidor inaccesible.

> En Ubuntu 24.04 el SSH viene activado por socket. Estos cambios se leen en cada conexión nueva, así que reiniciar `ssh` es suficiente. Si más adelante cambias el **puerto**, ahí sí hay que tocar `ssh.socket`.

### El nombre del archivo es `01-`, y no es un detalle

**En SSH gana la PRIMERA aparición de cada directiva, no la última.** Es al revés de lo que asume casi todo el mundo, y los archivos de `sshd_config.d/` se leen en orden alfabético.

La imagen de Contabo llega con dos archivos ya puestos ahí:

```
50-cloud-init.conf
60-cloudimg-settings.conf
```

Ambos anteriores a un `99-`. Uno de ellos trae `PasswordAuthentication yes`, así que un archivo llamado `99-hardening.conf` **queda decorativo para esa directiva**: se lee, pero pierde. El síntoma es engañoso, porque las directivas que nadie más define —`PermitRootLogin`, por ejemplo— sí se aplican, y el archivo parece estar funcionando.

Por eso va como `01-`: gana siempre. Y por eso **no se borran** los otros dos: cloud-init puede regenerar el suyo en cada arranque y reabrir el acceso por contraseña sin que nadie se entere.

### Verificación

Lo único que prueba algo es la configuración **efectiva**, no el contenido de los archivos:

```bash
sudo sshd -T | grep -Ei 'permitrootlogin|passwordauthentication'
```

Tiene que responder exactamente:

```
permitrootlogin no
passwordauthentication no
```

Y ahora, **desde una tercera terminal**, antes de cerrar nada:

```bash
ssh crm@TU_IP          # debe responder: ok
ssh root@TU_IP         # debe responder: Permission denied (publickey)
```

Lee con cuidado la respuesta de root. **`Permission denied (publickey)` es correcto**: significa que la clave es el único método que ofrece el servidor. Si en cambio te muestra `root@...'''s password:`, el acceso por contraseña sigue abierto y la configuración no se aplicó — vuelve al apartado anterior. Que aparezca un prompt de contraseña no significa que root esté habilitado; SSH pide credenciales igual y las rechaza siempre, para no revelar qué cuentas existen.

Añade una capa contra fuerza bruta:

```bash
sudo apt install -y fail2ban
sudo systemctl enable --now fail2ban
```

La configuración por defecto de Ubuntu ya protege SSH. Con `PasswordAuthentication no` el riesgo real ya es bajo; fail2ban baja el ruido en los logs.

---

## 3. Sistema al día y utilidades base

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y ca-certificates curl gnupg git ufw dnsutils htop jq tar
sudo timedatectl set-timezone America/Bogota
sudo hostnamectl set-hostname crm
```

Comprueba que el reloj está sincronizado:

```bash
timedatectl status | grep -E 'synchronized|NTP'
```

Debe decir `System clock synchronized: yes`. **Esto importa más de lo que parece**: los JWT de Supabase caducan por tiempo y los certificados TLS se validan por fecha. Un reloj desfasado produce fallos de autenticación intermitentes, del tipo que cuesta días diagnosticar.

Activa las actualizaciones de seguridad automáticas:

```bash
sudo apt install -y unattended-upgrades
sudo tee /etc/apt/apt.conf.d/20auto-upgrades > /dev/null <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF
```

Esto actualiza el sistema operativo, no las imágenes Docker. El stack se actualiza a mano y con respaldo previo, como dice `design.md`.

---

## 4. Swap

Con los 12 GB contratados el `next build` ya no depende del swap para terminar — con 8 GB sí dependía. Aun así se configuran 4 GB: es el colchón ante un pico puntual, y cuesta cuatro comandos:

```bash
sudo fallocate -l 4G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

Que solo se use en emergencias, no de forma rutinaria — swap en caliente sobre Postgres degrada todo:

```bash
echo 'vm.swappiness=10' | sudo tee /etc/sysctl.d/99-swappiness.conf
sudo sysctl --system
```

Verifica: `free -h` debe mostrar 4 GB de swap.

---

## 5. Firewall

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable
sudo ufw status verbose
```

Solo tres puertos abiertos. Nada de 5432, 8000 ni 3000.

### La trampa de UFW con Docker

**Docker escribe sus propias reglas de iptables y se salta UFW.** Un contenedor con `ports: - "5432:5432"` queda accesible desde internet aunque `ufw status` jure que el puerto está cerrado. Es un error clásico, y expone la base entera.

Nuestro diseño lo evita de raíz: **ningún servicio del stack publica puertos al host**. Se comunican por la red interna de Docker y solo el reverse proxy escucha en 80 y 443. Por eso, cuando revises los archivos compose, cualquier línea `ports:` que no sea la de Caddy es un error, no una comodidad.

Si aun así necesitas publicar algo temporalmente, átalo a loopback y llega por túnel SSH:

```yaml
ports:
  - "127.0.0.1:5432:5432"   # solo local; se alcanza con ssh -L
```

---

## 6. Docker Engine

Desde el repositorio oficial. **No uses `apt install docker.io` ni la versión de snap**: van por detrás en versiones y la de snap confina el acceso al sistema de archivos de formas que rompen los volúmenes.

```bash
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

> En Debian cambia `ubuntu` por `debian` en ambas URLs.

Permite usar Docker sin `sudo`:

```bash
sudo usermod -aG docker crm
```

Cierra la sesión y vuelve a entrar para que el grupo tome efecto. Verifica:

```bash
docker run --rm hello-world
docker compose version     # v2 o superior (en agosto de 2026, v5.5.0)
```

### Rotación de logs de Docker

Sin esto, los logs de los contenedores crecen sin límite hasta llenar el disco. Con diez contenedores hablando, pasa en semanas:

```bash
sudo tee /etc/docker/daemon.json > /dev/null <<'EOF'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" }
}
EOF

sudo systemctl restart docker
```

Máximo 30 MB de log por contenedor. Aplica a los contenedores creados **después** del reinicio, que en este momento son todos.

---

## 7. DNS

Tres registros `A` apuntando a la IP del servidor. El dominio es **loramotors.co**:

| Nombre | Tipo | Valor | Para qué |
|---|---|---|---|
| `@` (apex) | A | TU_IP | Vitrina pública y CRM — el app Next |
| `www` | A | TU_IP | Redirige al apex desde Caddy |
| `supabase` | A | TU_IP | Gateway de Supabase |

Los tres apuntan a **la misma IP**: Caddy los distingue por el nombre de host (SNI) y emite un certificado para cada uno. Varios hostnames no significan varias IPs.

El de `supabase` tiene que ser público, y esto sorprende a quien autoaloja por primera vez. `design.md` explica por qué: el navegador habla directo con Supabase, y Meta descarga las fotos de los vehículos desde las URLs públicas de Storage para publicarlas en Instagram.

Si el servidor tiene IPv6, añade los `AAAA` equivalentes o el navegador podría intentar por IPv6 y fallar.

**Verifica la propagación antes de seguir**:

```bash
dig +short loramotors.co
dig +short www.loramotors.co
dig +short supabase.loramotors.co
```

Los tres deben devolver la IP del servidor. Esperar aquí no es opcional: Let's Encrypt limita los intentos fallidos de validación, y arrancar el proxy con el DNS a medio propagar te deja una hora sin poder pedir certificados.

**Si usas Cloudflare**: pon los tres registros en modo **DNS only** (nube gris), al menos hasta que los certificados estén emitidos y todo funcione. El proxy naranja intercepta el TLS y complica tanto la validación como el WebSocket de Realtime.

---

## 8. Lo que NO debe estar instalado

Comprueba que nada más ocupa los puertos del proxy:

```bash
sudo ss -tlnp | grep -E ':(80|443)\s'
```

Si devuelve algo, hay un Apache o Nginx del proveedor corriendo. Quítalo:

```bash
sudo systemctl disable --now apache2 nginx 2>/dev/null
sudo apt purge -y apache2 nginx 2>/dev/null
```

Tampoco instales Postgres, Node ni el CLI de Supabase en el host. Todo vive en contenedores — es justamente lo que hace el despliegue reproducible. El CLI de Supabase, en particular, no hace falta: las migraciones se aplican con `psql` dentro del contenedor de la base.

---

## 9. Directorio del proyecto

```bash
sudo mkdir -p /opt/crm
sudo chown crm:crm /opt/crm
git clone TU_REPO /opt/crm
cd /opt/crm
```

`/opt` es la ubicación convencional para software desplegado a mano. Que pertenezca al usuario `crm` permite operar sin `sudo` en el día a día.

Los volúmenes de Docker viven en `/var/lib/docker/volumes`, en el disco raíz. Si tu proveedor te dio un disco de datos aparte, móntalo ahí antes de levantar nada — moverlo después, con Postgres ya escribiendo, es mucho más incómodo.

---

## 10. Credenciales que necesitas a mano

Antes de arrancar el stack, ten reunido esto. Que falte un dato a mitad del despliegue es lo que convierte una hora de trabajo en una tarde:

- **Acceso al DNS del dominio** — para los registros del paso 7.
- **Correo electrónico** para los avisos de vencimiento de Let's Encrypt.
- **Meta App ID y App Secret** (Meta for Developers → App Settings → Basic). El App Secret es obligatorio: el webhook rechaza toda petición sin firma válida.
- **Credenciales de WhatsApp Business** de la cuenta que vas a conectar.
- **Un gestor de contraseñas** donde guardar los secretos que se generarán. `ENCRYPTION_KEY` merece atención especial: si se pierde, las credenciales de Meta guardadas quedan ilegibles y hay que reconectar WhatsApp en cada cuenta.

---

## 11. Verificación final

Todo esto debe pasar antes de seguir con `tasks.md`:

```bash
# Acceso
ssh crm@TU_IP 'echo ok'                    # entra sin contraseña
ssh root@TU_IP 2>&1 | grep -q denied && echo "root bloqueado"

# Sistema
timedatectl status | grep synchronized     # yes
free -h | grep Swap                        # 4 GB
sudo ufw status | head -5                  # active, solo 22/80/443

# Docker
docker run --rm hello-world                # sin sudo
docker compose version                     # v2 o superior
cat /etc/docker/daemon.json                # rotación de logs

# Red
dig +short loramotors.co                   # TU_IP
dig +short www.loramotors.co               # TU_IP
dig +short supabase.loramotors.co          # TU_IP
sudo ss -tlnp | grep -E ':(80|443)\s'      # vacío

# Proyecto
ls /opt/crm/supabase/migrations | wc -l    # 53
```

Con esos resultados el servidor está listo, y puedes empezar por el grupo 1 de `tasks.md`.

---

## Apéndice: por qué este orden

Los pasos están encadenados a propósito, y saltárselos cuesta caro:

- **SSH antes que firewall.** Si activas UFW sin confirmar que entras como el usuario nuevo, te quedas fuera y toca recuperar por la consola web del proveedor.
- **Firewall antes que Docker.** Instalar Docker primero y UFW después deja un hueco: las reglas de Docker se insertan antes en la cadena de iptables.
- **Swap antes de construir nada.** El primer `docker compose build` es justo donde aparece el OOM.
- **DNS antes que el proxy.** Let's Encrypt cuenta los fallos y aplica límites; llegar con el DNS listo evita esperas de una hora.
- **Rotación de logs antes del primer contenedor.** Solo aplica a los que se creen después de reiniciar el demonio.
