'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Save } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';

import { createClient } from '@/lib/supabase/client';
import type { CustomField } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface ContactCustomFieldsFormProps {
  contactId: string;
  readOnly: boolean;
}

/**
 * Campos personalizados del contacto. Mismo guardado que el panel que
 * reemplaza: borra los valores y vuelve a insertar los que tienen texto.
 */
export function ContactCustomFieldsForm({ contactId, readOnly }: ContactCustomFieldsFormProps) {
  const t = useTranslations('Contacts.detailView');
  const [fields, setFields] = useState<CustomField[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const supabase = createClient();
    const [fieldsRes, valuesRes] = await Promise.all([
      supabase.from('custom_fields').select('*').order('field_name'),
      supabase.from('contact_custom_values').select('*').eq('contact_id', contactId),
    ]);
    if (fieldsRes.data) setFields(fieldsRes.data);
    if (valuesRes.data) {
      const map: Record<string, string> = {};
      valuesRes.data.forEach((v) => {
        map[v.custom_field_id] = v.value ?? '';
      });
      setValues(map);
    }
    setLoading(false);
  }, [contactId]);

  useEffect(() => {
    load();
  }, [load]);

  async function save() {
    setSaving(true);
    const supabase = createClient();
    try {
      await supabase.from('contact_custom_values').delete().eq('contact_id', contactId);
      const rows = Object.entries(values)
        .filter(([, val]) => val.trim())
        .map(([fieldId, val]) => ({ contact_id: contactId, custom_field_id: fieldId, value: val.trim() }));
      if (rows.length > 0) {
        const { error } = await supabase.from('contact_custom_values').insert(rows);
        if (error) throw error;
      }
      toast.success(t('toastCustomFieldsSaved'));
    } catch {
      toast.error(t('toastCustomFieldsFailed'));
    }
    setSaving(false);
  }

  if (loading) {
    return <Loader2 className="text-muted-foreground size-4 animate-spin" />;
  }
  if (fields.length === 0) {
    return <p className="text-muted-foreground text-xs">{t('noCustomFields')}</p>;
  }

  if (readOnly) {
    return (
      <dl className="space-y-2 text-sm">
        {fields.map((field) => (
          <div key={field.id}>
            <dt className="text-muted-foreground text-xs capitalize">{field.field_name}</dt>
            <dd className="text-foreground break-words">{values[field.id] || '—'}</dd>
          </div>
        ))}
      </dl>
    );
  }

  return (
    <div className="space-y-3">
      {fields.map((field) => (
        <div key={field.id} className="space-y-1.5">
          <Label className="text-muted-foreground text-xs capitalize">{field.field_name}</Label>
          <Input
            value={values[field.id] ?? ''}
            onChange={(e) => setValues((prev) => ({ ...prev, [field.id]: e.target.value }))}
            placeholder={t('enterCustomField', { name: field.field_name })}
            className="bg-muted border-border text-foreground placeholder:text-muted-foreground h-8 text-sm"
          />
        </div>
      ))}
      <Button
        onClick={save}
        disabled={saving}
        className="bg-primary hover:bg-primary/90 text-primary-foreground w-full"
        size="sm"
      >
        {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
        {t('saveCustomFieldsBtn')}
      </Button>
    </div>
  );
}
