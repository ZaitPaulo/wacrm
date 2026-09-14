'use client';

import { useMemo, useState } from 'react';
import { Check, ChevronsUpDown, Search } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { filterContacts, type PickableContact } from '@/lib/contacts/filter-contacts';

/** Filas que se dibujan a la vez. Más que eso ya no se lee: se busca. */
const MAX_SHOWN = 50;

export interface ContactPickerLabels {
  /** La opción "nadie" y lo que muestra el botón cuando no hay nadie. */
  none: string;
  search: string;
  empty: string;
  /** "Y N más: escribe para acotar." */
  more: (count: number) => string;
}

interface ContactPickerProps {
  id?: string;
  contacts: PickableContact[];
  /** El id elegido; `''` es nadie. */
  value: string;
  onChange: (contactId: string) => void;
  labels: ContactPickerLabels;
  disabled?: boolean;
}

function contactName(c: PickableContact): string {
  return c.name?.trim() || c.phone || '—';
}

/**
 * Lista de contactos con buscador, para elegir uno.
 *
 * Existe porque un `Select` con los contactos de la cuenta —cientos, y
 * con homónimos— no se puede usar: acá se escribe parte del nombre o del
 * teléfono y cada fila muestra el teléfono, que es lo que distingue a dos
 * "Alberto Barros".
 */
export function ContactPicker({
  id,
  contacts,
  value,
  onChange,
  labels,
  disabled,
}: ContactPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const selected = contacts.find((c) => c.id === value) ?? null;
  const { shown, hidden } = useMemo(
    () => filterContacts(contacts, query, MAX_SHOWN),
    [contacts, query]
  );

  function pick(contactId: string) {
    onChange(contactId);
    setOpen(false);
    setQuery('');
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery('');
      }}
    >
      <PopoverTrigger
        render={
          <Button
            id={id}
            type="button"
            variant="outline"
            disabled={disabled}
            className="w-full justify-between font-normal"
          />
        }
      >
        <span className={cn('truncate', !selected && 'text-muted-foreground')}>
          {selected ? (
            <>
              {contactName(selected)}
              {selected.name && selected.phone && (
                <span className="text-muted-foreground"> · {selected.phone}</span>
              )}
            </>
          ) : (
            labels.none
          )}
        </span>
        <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
      </PopoverTrigger>

      <PopoverContent align="start" className="w-(--anchor-width) min-w-72 p-2">
        <div className="relative">
          <Search className="text-muted-foreground absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2" />
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={labels.search}
            className="pl-8"
          />
        </div>

        <div role="listbox" className="max-h-64 overflow-y-auto">
          {/* "Nadie" solo sin búsqueda: al escribir se busca a alguien. */}
          {!query.trim() && (
            <PickerOption selected={!value} onSelect={() => pick('')}>
              <span className="text-muted-foreground">{labels.none}</span>
            </PickerOption>
          )}
          {shown.map((c) => (
            <PickerOption key={c.id} selected={c.id === value} onSelect={() => pick(c.id)}>
              <span className="truncate">{contactName(c)}</span>
              {c.name && c.phone && (
                <span className="text-muted-foreground ml-auto shrink-0 text-xs">
                  {c.phone}
                </span>
              )}
            </PickerOption>
          ))}
          {shown.length === 0 && (
            <p className="text-muted-foreground px-2 py-3 text-center text-xs">
              {labels.empty}
            </p>
          )}
          {hidden > 0 && (
            <p className="text-muted-foreground px-2 py-2 text-center text-xs">
              {labels.more(hidden)}
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function PickerOption({
  selected,
  onSelect,
  children,
}: {
  selected: boolean;
  onSelect: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onSelect}
      className="hover:bg-accent hover:text-accent-foreground flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm"
    >
      <Check className={cn('h-4 w-4 shrink-0', selected ? 'opacity-100' : 'opacity-0')} />
      {children}
    </button>
  );
}
