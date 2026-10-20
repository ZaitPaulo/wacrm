'use client';

import { useState } from 'react';
import { Loader2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

interface ContactNoteBoxProps {
  contactId: string;
  onAdded: () => void;
}

/**
 * "Escribe una nota" encima de la hoja de vida. Cualquier asesor la deja
 * sobre cualquier cliente del negocio, a su nombre (migración 553). Las
 * notas no tienen pestaña aparte: se leen en la línea de tiempo.
 */
export function ContactNoteBox({ contactId, onAdded }: ContactNoteBoxProps) {
  const t = useTranslations('Contacts.detailView');
  const { accountId, user } = useAuth();
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!text.trim()) return;
    if (!user || !accountId) {
      toast.error(t('toastNotAuthenticated'));
      return;
    }
    setSaving(true);
    const { error } = await createClient().from('contact_notes').insert({
      contact_id: contactId,
      account_id: accountId,
      user_id: user.id,
      note_text: text.trim(),
    });
    if (error) {
      toast.error(t('toastNoteAddFailed'));
    } else {
      setText('');
      toast.success(t('toastNoteAdded'));
      onAdded();
    }
    setSaving(false);
  }

  return (
    <div className="space-y-2">
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t('notesTab.placeholder')}
        className="bg-muted border-border text-foreground placeholder:text-muted-foreground min-h-[60px] resize-none text-sm"
      />
      <div className="flex justify-end">
        <Button
          onClick={save}
          disabled={!text.trim() || saving}
          className="bg-primary hover:bg-primary/90 text-primary-foreground"
          size="sm"
        >
          {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
          {t('notesTab.save')}
        </Button>
      </div>
    </div>
  );
}
