/**
 * A qué dirección le habla el SERVIDOR cuando consulta Supabase.
 *
 * En el despliegue autoalojado el app y el stack de Supabase son
 * contenedores vecinos en la misma red de Docker, pero el servidor le
 * hablaba a la base por `NEXT_PUBLIC_SUPABASE_URL` — la URL pública. Eso
 * lo hacía salir por DNS externo hasta la IP pública del propio servidor
 * y volver a entrar por Caddy, para alcanzar algo que tenía a un salto.
 *
 * No es un rodeo cosmético: el 2026-09-08 la resolución externa del
 * contenedor empezó a fallar de a ratos (EAI_AGAIN, y después
 * ConnectTimeoutError contra el 443) y **se perdieron mensajes entrantes
 * de WhatsApp**. El webhook le responde 200 a Meta antes de procesar, así
 * que cuando la primera consulta a la base no salía, Meta ya tenía su
 * confirmación y no reintentaba nunca. Con `SUPABASE_INTERNAL_URL`
 * apuntando a `http://api-gw:8000`, el camino de datos deja de depender
 * del DNS externo, de la IP pública, del TLS y de Caddy.
 *
 * Sin la variable devuelve la URL pública, así que quien no autoaloje
 * —Supabase Cloud, desarrollo local— no cambia en nada.
 *
 * ## Por qué NO se usa en todas partes
 *
 * Hay dos familias de código que TIENEN que seguir con la URL pública, y
 * cambiarlas rompe cosas de formas que no se ven hasta producción:
 *
 * 1. **Lo que lee o escribe la cookie de sesión** (`supabase/server.ts`,
 *    `proxy.ts`). supabase-js deriva el nombre de la cookie del hostname:
 *    `sb-${hostname.split('.')[0]}-auth-token`. El navegador guarda
 *    `sb-supabase-auth-token`; un servidor apuntando a `api-gw` buscaría
 *    `sb-api-gw-auth-token` y no encontraría sesión alguna. Se caen todos
 *    los logins.
 *
 * 2. **Lo que genera URLs públicas de Storage** (`social/images.ts`).
 *    `getPublicUrl()` construye la dirección a partir de la URL del
 *    cliente, y esas URLs se las damos a Meta para que descargue las
 *    fotos de los vehículos. Con la interna quedarían
 *    `http://api-gw:8000/...`, que Meta no puede abrir.
 *
 * Por eso esto se aplica solo a clientes de service-role que hacen acceso
 * a datos y nada más.
 *
 * ## Por qué la variable no lleva `NEXT_PUBLIC_`
 *
 * Next.js sustituye las referencias a `process.env.NEXT_PUBLIC_*` en
 * tiempo de compilación, también en el código de servidor, y el
 * `docker-compose.yml` de la raíz pasa esas variables como build args. Un
 * nombre con ese prefijo quedaría horneado en la imagen y no se podría
 * cambiar sin reconstruir. Sin el prefijo se lee de verdad en ejecución.
 */
export function serverSupabaseUrl(): string {
  return (
    process.env.SUPABASE_INTERNAL_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!
  );
}
