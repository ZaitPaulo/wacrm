// ============================================================
// Cómo se acomodan en una columna las citas que se solapan.
//
// En la vista Semana las citas de varios asesores caen en la misma
// columna del día, y en cualquier vista una cita cancelada puede quedar
// debajo de la que ocupó su franja. Las que se cruzan se reparten el
// ancho en carriles, como en cualquier calendario.
// ============================================================

export interface LayoutInput {
  id: string;
  starts_at: string | Date;
  ends_at: string | Date;
}

export interface LayoutSlot {
  /** Carril de la cita, desde 0. */
  lane: number;
  /** Carriles del grupo de citas que se cruzan con ella. */
  lanes: number;
}

/**
 * Asigna a cada cita el primer carril libre, y a cada grupo de citas
 * encadenadas por cruces el número de carriles que usa. Intervalos
 * semiabiertos: una cita que termina a las 9:30 no choca con la que
 * empieza a las 9:30.
 */
export function layoutColumn(items: LayoutInput[]): Map<string, LayoutSlot> {
  const sorted = items
    .map((i) => ({
      id: i.id,
      start: new Date(i.starts_at).getTime(),
      end: new Date(i.ends_at).getTime(),
    }))
    .sort((a, b) => a.start - b.start || b.end - a.end);

  const out = new Map<string, LayoutSlot>();
  let group: { id: string; lane: number }[] = [];
  let laneEnds: number[] = [];
  let groupEnd = -Infinity;

  const closeGroup = () => {
    const lanes = Math.max(1, laneEnds.length);
    for (const g of group) out.set(g.id, { lane: g.lane, lanes });
    group = [];
    laneEnds = [];
  };

  for (const item of sorted) {
    if (item.start >= groupEnd) {
      closeGroup();
      groupEnd = -Infinity;
    }
    let lane = laneEnds.findIndex((end) => end <= item.start);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(item.end);
    } else {
      laneEnds[lane] = item.end;
    }
    group.push({ id: item.id, lane });
    groupEnd = Math.max(groupEnd, item.end);
  }
  closeGroup();
  return out;
}
