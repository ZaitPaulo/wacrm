'use client';

// ============================================================
// La grilla ordenable de fotos de un vehículo.
//
// Vive acá y no dentro de una pantalla porque la usan dos: la ficha de
// /inventory y la tarjeta de /instagram. Es el mismo dato editado desde
// dos lugares —`inventory_vehicles.images`, cuyo orden ES el orden de
// publicación y el de la vitrina— y si el gesto se implementara dos
// veces, en seis meses se comportaría distinto en cada una.
//
// Lo que cambia entre las dos pantallas entra por props: si se puede
// eliminar, si es de solo lectura, y dónde cae el máximo de fotos que
// aceptan las redes. Nada más.
//
// Se arrastra desde CUALQUIER punto de la foto. Los botones que van
// encima (eliminar, hacer portada) frenan el `pointerdown` para que
// pulsarlos no empiece un arrastre.
// ============================================================

import { useMemo, type ReactNode } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Star, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { makeCoverImage, reorderImages } from '@/lib/inventory/photo-order';

interface VehiclePhotoOrderProps {
  /** Las URLs, en el orden actual. */
  images: string[];
  /** El orden nuevo, ya reordenado. No se llama en modo lectura. */
  onChange: (next: string[]) => void;
  /**
   * Quitar una foto. Ausente = esta pantalla no elimina fotos, que es
   * el caso de la cola de publicaciones: ahí se ordena lo que se va a
   * publicar, no se edita el inventario.
   */
  onRemove?: (index: number) => void;
  /** Se ven las fotos y no se tocan. */
  readOnly?: boolean;
  /**
   * Cuántas fotos entran en la red más restrictiva. Las que caen
   * después se atenúan, porque el recorte es por el final y quien
   * ordena tiene que saber qué está dejando afuera. `null` = no hay
   * corte que señalar.
   */
  cutoff?: number | null;
  /** Se dibuja como una celda más al final: el botón de subir. */
  append?: ReactNode;
}

/**
 * Una clave estable por foto.
 *
 * No alcanza con la URL: nada impide que la misma imagen esté cargada
 * dos veces, y `useSortable` con ids repetidos deja de saber cuál
 * arrastró. Se le agrega cuántas veces apareció antes, que es estable
 * frente al reordenamiento — dos copias idénticas son intercambiables,
 * así que su orden relativo no cambia nada.
 *
 * El índice pelado NO sirve como id: al mover un elemento cambiarían
 * todos los ids y el reordenamiento se aplicaría sobre la posición
 * equivocada.
 */
function useStableIds(images: string[]): string[] {
  return useMemo(() => {
    const seen = new Map<string, number>();
    return images.map((url) => {
      const n = seen.get(url) ?? 0;
      seen.set(url, n + 1);
      return `${url}::${n}`;
    });
  }, [images]);
}

/**
 * La grilla de fotos, ordenable arrastrando.
 *
 * NO GUARDA NADA: avisa el orden nuevo por `onChange` y quien la usa
 * decide cuándo persistirlo. En la ficha del inventario eso ocurre al
 * enviar el formulario; en la cola de publicaciones, con un botón
 * propio. Esa diferencia es la razón de que el guardado no viva acá.
 */
export function VehiclePhotoOrder({
  images,
  onChange,
  onRemove,
  readOnly = false,
  cutoff = null,
  append,
}: VehiclePhotoOrderProps) {
  const t = useTranslations('PhotoOrder');
  const ids = useStableIds(images);

  // Con una sola foto no hay nada que decidir: no se ofrece ni
  // arrastrar ni designar portada. Eliminar sí sigue estando.
  const sortable = !readOnly && images.length > 1;

  const sensors = useSensors(
    // Umbral de 8px: como se arrastra desde toda la miniatura, sin él
    // cualquier clic sobre la foto contaría como un arrastre de cero
    // distancia.
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    // En táctil manda el retardo: el gesto tiene que distinguirse del
    // desplazamiento de la pantalla, que es el caso principal — un
    // vendedor ordenando fotos desde el celular.
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 5 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const positionOf = (id: string) => ids.indexOf(id) + 1;

  // Los anuncios de @dnd-kit vienen en inglés y sin conectar. Se
  // traducen acá porque reordenar tiene que poder hacerse con el
  // teclado, y sin anuncios ese recorrido es a ciegas.
  const announcements: Announcements = {
    onDragStart: ({ active }) =>
      t('a11y.picked', { position: positionOf(String(active.id)) }),
    onDragOver: ({ over }) =>
      over ? t('a11y.over', { position: positionOf(String(over.id)) }) : '',
    onDragEnd: ({ over }) =>
      over
        ? t('a11y.dropped', { position: positionOf(String(over.id)) })
        : t('a11y.cancelled'),
    onDragCancel: () => t('a11y.cancelled'),
  };

  /**
   * Traduce el evento de @dnd-kit —que habla de ids— a posiciones del
   * arreglo. Un id que ya no está en la lista se ignora: la cola se
   * recarga sola y la foto pudo desaparecer a mitad del arrastre.
   */
  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    onChange(reorderImages(images, from, to));
  }

  /** La lleva al frente conservando el orden relativo del resto. */
  function makeCover(index: number) {
    if (index === 0) return;
    onChange(makeCoverImage(images, index));
  }

  // Solo se señala el corte si de verdad deja fotos afuera: un
  // vehículo de tres fotos no tiene por qué enterarse de que la red
  // acepta diez.
  const cut =
    cutoff !== null && cutoff !== undefined && images.length > cutoff
      ? cutoff
      : null;

  const grid = (
    <div className="flex flex-wrap gap-2">
      {images.map((url, i) => (
        <PhotoTile
          key={ids[i]}
          id={ids[i]}
          url={url}
          index={i}
          sortable={sortable}
          excluded={cut !== null && i >= cut}
          onRemove={onRemove ? () => onRemove(i) : undefined}
          onMakeCover={sortable ? () => makeCover(i) : undefined}
        />
      ))}
      {append}
    </div>
  );

  return (
    <div className="space-y-2">
      {sortable ? (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
          accessibility={{ announcements }}
        >
          <SortableContext items={ids} strategy={rectSortingStrategy}>
            {grid}
          </SortableContext>
        </DndContext>
      ) : (
        grid
      )}

      {cut !== null && (
        <p className="text-muted-foreground text-xs">
          {t('cutoffHint', { max: cut, extra: images.length - cut })}
        </p>
      )}
    </div>
  );
}

/**
 * Una foto de la grilla: la imagen, sus dos controles y su estado.
 *
 * Es la agarradera del arrastre, así que todo lo pulsable que va encima
 * tiene que frenar el `pointerdown` para no confundirse con el gesto.
 */
function PhotoTile({
  id,
  url,
  index,
  sortable,
  excluded,
  onRemove,
  onMakeCover,
}: {
  id: string;
  url: string;
  index: number;
  sortable: boolean;
  excluded: boolean;
  onRemove?: () => void;
  onMakeCover?: () => void;
}) {
  const t = useTranslations('PhotoOrder');
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled: !sortable });

  return (
    // TODA la miniatura es la agarradera. `attributes` trae además
    // `role="button"` y `tabIndex`, así que el mismo elemento es el que
    // recibe el foco y activa el `KeyboardSensor`: no hace falta un asa
    // aparte para que reordenar se pueda hacer sin mouse.
    <div
      ref={setNodeRef}
      {...(sortable ? attributes : {})}
      {...(sortable ? listeners : {})}
      aria-label={sortable ? t('dragHandle') : undefined}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
      }}
      className={`border-border relative size-20 overflow-hidden rounded-md border ${
        // La manito: que se vea que la foto se agarra, sin tener que
        // descubrirlo probando.
        sortable ? 'cursor-grab active:cursor-grabbing' : ''
      } ${
        // Las que no entran en el carrusel se ven, pero se ven apagadas:
        // siguen sirviendo en la vitrina pública, que no tiene tope.
        excluded ? 'opacity-45 grayscale' : ''
      }`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt="" className="size-full object-cover" />

      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          // El `pointerdown` NO puede llegar al contenedor: ahí vive el
          // sensor de arrastre, y sin esto un toque sobre la X —sobre
          // todo en táctil, donde el dedo se mueve— empieza a arrastrar
          // en vez de borrar. Es lo que antes resolvía el asa dedicada.
          onPointerDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          className="absolute top-0.5 right-0.5 cursor-pointer rounded-full bg-black/60 p-0.5 text-white"
          title={t('remove')}
          aria-label={t('remove')}
        >
          <X className="size-3" />
        </button>
      )}

      {index === 0 ? (
        <span className="absolute inset-x-0 bottom-0 bg-black/60 text-center text-[10px] text-white">
          {t('cover')}
        </span>
      ) : (
        // Arrastrar de la posición quince a la primera, en una grilla
        // que hace scroll, es el caso más incómodo del gesto — y es el
        // más frecuente, porque lo que casi siempre se quiere cambiar
        // es la portada.
        onMakeCover && (
          <button
            type="button"
            onClick={onMakeCover}
            // Mismo motivo que la X: es un botón encima de la superficie
            // de arrastre y tiene que poder pulsarse sin arrastrar.
            onPointerDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            className="absolute inset-x-0 bottom-0 cursor-pointer bg-black/60 py-0.5 text-center text-white"
            title={t('makeCover')}
            aria-label={t('makeCover')}
          >
            <Star className="mx-auto size-3" />
          </button>
        )
      )}
    </div>
  );
}
