import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function createClient() {
  const cookieStore = await cookies()

  // NO cambiar por serverSupabaseUrl(): este cliente lee la cookie de
  // sesión, y supabase-js deriva su nombre del hostname
  // (`sb-${hostname.split('.')[0]}-auth-token`). El navegador guarda
  // `sb-supabase-auth-token`; apuntando a la URL interna buscaríamos
  // `sb-api-gw-auth-token` y no habría sesión para nadie. La ruta
  // interna es solo para los clientes de service-role que no tocan
  // cookies — ver src/lib/supabase/server-url.ts.
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // The `setAll` method was called from a Server Component.
            // This can be ignored if you have middleware refreshing sessions.
          }
        },
      },
    }
  )
}
