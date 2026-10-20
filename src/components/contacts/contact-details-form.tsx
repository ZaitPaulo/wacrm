'use client';

import { useState } from 'react';
import { Loader2, Save } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';

import { createClient } from '@/lib/supabase/client';
import type { Contact } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface ContactDetailsFormProps {
  contact: Contact;
  /** Sin permiso de escritura (`contacts_update`): se muestra sin editar. */
  readOnly: boolean;
  onSaved: () => void;
}

/**
 * Nombre, teléfono, correo y empresa del contacto. Sacado del panel
 * lateral que tenía Contactos; la ficha lo muestra en solo lectura a
 * quien no atiende al contacto, porque la base le negaría el guardado.
 */
export function ContactDetailsForm({ contact, readOnly, onSaved }: ContactDetailsFormProps) {
  const t = useTranslations('Contacts.detailView');
  const [name, setName] = useState(contact.name ?? '');
  const [phone, setPhone] = useState(contact.phone ?? '');
  const [email, setEmail] = useState(contact.email ?? '');
  const [company, setCompany] = useState(contact.company ?? '');
  const [saving, setSaving] = useState(false);

  if (readOnly) {
    const rows: [string, string | null | undefined][] = [
      [t('name'), contact.name],
      [t('phone'), contact.phone],
      [t('email'), contact.email],
      [t('company'), contact.company],
    ];
    return (
      <dl className="space-y-2 text-sm">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt className="text-muted-foreground text-xs">{label}</dt>
            <dd className="text-foreground break-words">{value || '—'}</dd>
          </div>
        ))}
      </dl>
    );
  }

  async function save() {
    if (!phone.trim()) {
      toast.error(t('toastPhoneRequired'));
      return;
    }
    setSaving(true);
    const { data, error } = await createClient()
      .from('contacts')
      .update({
        name: name.trim() || null,
        phone: phone.trim(),
        email: email.trim() || null,
        company: company.trim() || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', contact.id)
      .select('id');
    // Sin filas = la RLS no lo dejó (dejó de atenderlo mientras miraba).
    if (error || !data || data.length === 0) {
      toast.error(t('toastUpdateFailed'));
    } else {
      toast.success(t('toastUpdated'));
      onSaved();
    }
    setSaving(false);
  }

  const fields: [string, string, (v: string) => void, boolean][] = [
    [t('name'), name, setName, false],
    [t('phone'), phone, setPhone, true],
    [t('email'), email, setEmail, false],
    [t('company'), company, setCompany, false],
  ];

  return (
    <div className="space-y-3">
      {fields.map(([label, value, set, required]) => (
        <div key={label} className="space-y-1.5">
          <Label className="text-muted-foreground text-xs">
            {label} {required && <span className="text-red-400">*</span>}
          </Label>
          <Input
            value={value}
            onChange={(e) => set(e.target.value)}
            className="bg-muted border-border text-foreground h-8 text-sm"
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
        {t('saveChangesBtn')}
      </Button>
    </div>
  );
}
