'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

/**
 * Cuántas publicaciones esperan revisión.
 *
 * Alimenta el indicador del sidebar. Existe por una razón concreta de
 * producto: una cola que nadie mira es trabajo manual con pasos de más,
 * y sin un número visible en la navegación no hay nada que recuerde que
 * hay vehículos esperando salir.
 *
 * La RLS de `social_posts` (migración 512) exige rol `admin`, así que a
 * un asesor esta consulta le devuelve cero y el indicador simplemente
 * no aparece. No hace falta filtrar por rol acá.
 */
export function usePendingPosts(): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    async function refresh() {
      // head:true evita traer las filas: solo interesa el conteo.
      const { count: pending, error } = await supabase
        .from('social_posts')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending');
      if (cancelled || error) return;
      setCount(pending ?? 0);
    }

    refresh();

    // Se recuenta en vez de llevar la cuenta a mano sumando y restando:
    // las filas cambian de estado por varios caminos —aprobar,
    // descartar, o el retiro automático cuando el vehículo deja de
    // estar disponible— y derivar el delta de cada uno se desincroniza
    // en cuanto aparezca un camino nuevo.
    const channel = supabase
      .channel('social-posts-pending-count')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'social_posts' },
        () => {
          void refresh();
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, []);

  return count;
}
