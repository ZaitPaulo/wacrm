'use client';

import { useCallback, useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';

import { createClient } from '@/lib/supabase/client';
import { addContactTag, deleteContactTag } from '@/lib/contacts/tag-api';
import type { Tag } from '@/types';

interface ContactTagsEditorProps {
  contactId: string;
  /** Sin permiso de escritura: solo se muestran las etiquetas puestas. */
  readOnly: boolean;
  onChanged?: () => void;
}

/**
 * Etiquetas del contacto: clic para poner o quitar. Pasa por
 * `/api/contacts/[id]/tags` (vía `tag-api`) para que se disparen las
 * automatizaciones de etiqueta, igual que en el panel que reemplaza.
 */
export function ContactTagsEditor({ contactId, readOnly, onChanged }: ContactTagsEditorProps) {
  const t = useTranslations('Contacts.detailView');
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const supabase = createClient();
    const [tagsRes, contactTagsRes] = await Promise.all([
      supabase.from('tags').select('*').order('name'),
      supabase.from('contact_tags').select('tag_id').eq('contact_id', contactId),
    ]);
    if (tagsRes.data) setAllTags(tagsRes.data);
    if (contactTagsRes.data) setSelectedIds(contactTagsRes.data.map((ct) => ct.tag_id));
  }, [contactId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function toggle(tagId: string) {
    setSaving(true);
    const isSelected = selectedIds.includes(tagId);
    try {
      if (isSelected) {
        await deleteContactTag(contactId, tagId);
        setSelectedIds((prev) => prev.filter((id) => id !== tagId));
      } else {
        await addContactTag(contactId, tagId);
        setSelectedIds((prev) => [...prev, tagId]);
      }
      onChanged?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('toastUpdateFailed'));
    }
    setSaving(false);
  }

  const visible = readOnly ? allTags.filter((tag) => selectedIds.includes(tag.id)) : allTags;

  if (visible.length === 0) {
    return (
      <p className="text-muted-foreground text-xs">
        {readOnly ? t('tabs.noTags') : t('tagsTab.noTagsAvailable')}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {!readOnly && <p className="text-muted-foreground text-xs">{t('tagsTab.clickTagDesc')}</p>}
      <div className="flex flex-wrap gap-2">
        {visible.map((tag) => {
          const selected = selectedIds.includes(tag.id);
          const style = { backgroundColor: tag.color + '20', color: tag.color };
          if (readOnly) {
            return (
              <span key={tag.id} className="inline-flex items-center rounded-full px-3 py-1 text-xs font-medium" style={style}>
                {tag.name}
              </span>
            );
          }
          return (
            <button
              key={tag.id}
              onClick={() => toggle(tag.id)}
              disabled={saving}
              className={`inline-flex cursor-pointer items-center rounded-full px-3 py-1 text-xs font-medium transition-all ${
                selected ? 'ring-primary ring-offset-border ring-2 ring-offset-1' : 'opacity-50 hover:opacity-80'
              }`}
              style={style}
            >
              {selected && <Check className="mr-1 size-3" />}
              {tag.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}
