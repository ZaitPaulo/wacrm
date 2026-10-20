'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import {
  ArrowLeft,
  BadgeDollarSign,
  Building2,
  CalendarPlus,
  CarFront,
  Check,
  Copy,
  LayoutTemplate,
  Loader2,
  Mail,
  Phone,
  PhoneCall,
} from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { hasMinRole } from '@/lib/auth/roles';
import { dateLocale } from '@/lib/date-locale';
import type { Contact, MessageTemplate } from '@/types';
import type { MessageChannel } from '@/lib/contacts/channel-identity';
import type { TimelineEvent } from '@/lib/contacts/timeline';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ChannelBadge } from '@/components/inbox/channel-badge';
import { TemplatePicker, type TemplateSendValues } from '@/components/inbox/template-picker';
import { ScheduleVisitDialog } from '@/components/agenda/schedule-visit-button';
import { ContactDetailsForm } from '@/components/contacts/contact-details-form';
import { ContactTagsEditor } from '@/components/contacts/contact-tags-editor';
import { ContactCustomFieldsForm } from '@/components/contacts/contact-custom-fields-form';
import { ContactDocuments } from '@/components/contacts/contact-documents';
import { ContactNoteBox } from '@/components/contacts/contact-note-box';
import { ContactTimeline } from '@/components/contacts/contact-timeline';
import { ContactThreadViewer } from '@/components/contacts/contact-thread-viewer';
import { InteractionDialog } from '@/components/contacts/interaction-dialog';
import { SellVehicleDialog } from '@/components/inventory/sell-vehicle-dialog';

/** Lo que devuelve `GET /api/contacts/[id]/summary` (`get_contact_summary`, 555). */
interface ContactSummary {
  client_since: string | null;
  agents: {
    conversation_id: string;
    channel: MessageChannel;
    agent_id: string | null;
    agent_name: string | null;
  }[];
  appointments_total: number;
  appointments_attended: number;
  vehicles_bought: number;
  vehicles_purchased: number;
  vehicles_traded_in: number;
  consignments: number;
  open_deals: number;
  /** Quien mira puede editar el contacto (agent+ y `contact_visible`). */
  can_edit: boolean;
}

function initials(name?: string | null) {
  if (!name) return '?';
  return name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

/**
 * Ficha del contacto a pantalla completa (`/contacts/[id]`): la hoja de
 * vida de un cliente del negocio.
 *
 * VER es de todo el equipo (migraciones 553 y 555): cualquier miembro
 * abre la ficha de cualquier contacto de su cuenta. ATENDER sigue siendo
 * del asignado: editar los datos, enviar una plantilla y agendar se
 * ofrecen solo si `can_edit`, que es la misma regla de la base. Notas e
 * interacciones, a todo `agent` o superior.
 */
export default function ContactProfilePage() {
  const { id } = useParams<{ id: string }>();
  const t = useTranslations('Contacts.profile');
  const tDetail = useTranslations('Contacts.detailView');
  const { user, accountRole } = useAuth();
  const isAgentPlus = !!accountRole && hasMinRole(accountRole, 'agent');
  const isAdmin = !!accountRole && hasMinRole(accountRole, 'admin');

  const [contact, setContact] = useState<Contact | null>(null);
  const [summary, setSummary] = useState<ContactSummary | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'notFound'>('loading');
  const [timelineKey, setTimelineKey] = useState(0);
  const [copied, setCopied] = useState(false);

  const [threadId, setThreadId] = useState<string | null>(null);
  const [interactionOpen, setInteractionOpen] = useState(false);
  const [editingInteraction, setEditingInteraction] = useState<TimelineEvent | null>(null);
  const [sellOpen, setSellOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [sendingTemplate, setSendingTemplate] = useState(false);

  const load = useCallback(async () => {
    const [contactRes, summaryRes] = await Promise.all([
      createClient().from('contacts').select('*').eq('id', id).maybeSingle(),
      fetch(`/api/contacts/${id}/summary`),
    ]);
    // Inexistente o de otra cuenta se ven igual: la RLS no lo devuelve.
    if (!contactRes.data || !summaryRes.ok) {
      setStatus('notFound');
      return;
    }
    setContact(contactRes.data as Contact);
    setSummary((await summaryRes.json()) as ContactSummary);
    setStatus('ready');
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  /** Algo nuevo en la hoja de vida: se vuelve a pedir, con su resumen. */
  const refresh = useCallback(() => {
    setTimelineKey((k) => k + 1);
    void load();
  }, [load]);

  async function copyPhone() {
    if (!contact?.phone) return;
    await navigator.clipboard.writeText(contact.phone);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function sendTemplate(template: MessageTemplate, values: TemplateSendValues) {
    setSendingTemplate(true);
    try {
      const res = await fetch('/api/whatsapp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // Sin conversation_id: la ruta busca o crea la del contacto.
          contact_id: id,
          message_type: 'template',
          template_name: template.name,
          template_language: template.language,
          template_message_params: {
            body: values.body,
            headerText: values.headerText,
            buttonParams: values.buttonParams,
          },
          template_params: values.body,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(tDetail('toastTemplateFailed', { reason: payload?.error || `HTTP ${res.status}` }));
        return;
      }
      toast.success(tDetail('toastTemplateSent', { name: template.name }));
      refresh();
    } catch (err) {
      toast.error(tDetail('toastTemplateFailed', { reason: err instanceof Error ? err.message : 'network error' }));
    } finally {
      setSendingTemplate(false);
    }
  }

  if (status === 'loading') {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="text-primary size-6 animate-spin" />
      </div>
    );
  }

  if (status === 'notFound' || !contact || !summary) {
    return (
      <div className="mx-auto max-w-md space-y-4 py-16 text-center">
        <p className="text-foreground text-lg font-medium">{t('notFound')}</p>
        <p className="text-muted-foreground text-sm">{t('notFoundHint')}</p>
        <Link href="/contacts" className="text-primary text-sm hover:underline">
          {t('backToContacts')}
        </Link>
      </div>
    );
  }

  const canEdit = summary.can_edit;
  // "Agendar visita": la conversación que atiende quien mira o, para
  // admin, la más reciente; de ahí sale la confirmación al cliente.
  const myThread = summary.agents.find((a) => a.agent_id === user?.id) ?? summary.agents[0] ?? null;
  const since = summary.client_since
    ? format(new Date(summary.client_since), 'd MMM yyyy', { locale: dateLocale() })
    : '—';

  const stats: [string, string | number][] = [
    [t('stats.since'), since],
    [t('stats.appointments'), t('stats.appointmentsValue', { total: summary.appointments_total, attended: summary.appointments_attended })],
    [t('stats.bought'), summary.vehicles_bought],
    [t('stats.purchased'), summary.vehicles_purchased],
    [t('stats.tradedIn'), summary.vehicles_traded_in],
    [t('stats.consignments'), summary.consignments],
    [t('stats.openDeals'), summary.open_deals],
  ];

  return (
    <div className="mx-auto w-full max-w-6xl space-y-4">
      <Link href="/contacts" className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm">
        <ArrowLeft className="size-4" />
        {t('backToContacts')}
      </Link>

      {/* Encabezado */}
      <div className="border-border bg-card rounded-xl border p-4">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <Avatar className="bg-muted border-border size-12 shrink-0 border">
              <AvatarFallback className="bg-primary/10 text-primary text-sm font-medium">
                {initials(contact.name)}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <h1 className="text-foreground truncate text-xl font-semibold">{contact.name || tDetail('unnamed')}</h1>
              <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                {contact.phone && (
                  <button onClick={copyPhone} className="hover:text-primary flex items-center gap-1">
                    <Phone className="size-3" />
                    {contact.phone}
                    {copied ? <Check className="text-primary size-3" /> : <Copy className="size-3" />}
                  </button>
                )}
                {contact.email && (
                  <span className="flex items-center gap-1 break-all">
                    <Mail className="size-3" />
                    {contact.email}
                  </span>
                )}
                {contact.company && (
                  <span className="flex items-center gap-1">
                    <Building2 className="size-3" />
                    {contact.company}
                  </span>
                )}
              </div>
              {/* Canales y quién atiende cada uno. */}
              <div className="mt-2 flex flex-wrap gap-2">
                {summary.agents.length === 0 ? (
                  <span className="text-muted-foreground text-xs">{t('noConversations')}</span>
                ) : (
                  summary.agents.map((a) => (
                    <span
                      key={a.conversation_id}
                      className="border-border text-foreground inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs"
                    >
                      <ChannelBadge channel={a.channel} />
                      {a.agent_name ?? t('unassigned')}
                    </span>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Acciones. Solo se ofrece lo que la base va a permitir. */}
          <div className="flex flex-wrap gap-2 md:justify-end">
            {isAgentPlus && (
              <Button size="sm" variant="outline" onClick={() => { setEditingInteraction(null); setInteractionOpen(true); }}>
                <PhoneCall className="size-4" />
                {t('actions.logInteraction')}
              </Button>
            )}
            {canEdit && (
              <Button size="sm" variant="outline" onClick={() => setScheduleOpen(true)}>
                <CalendarPlus className="size-4" />
                {t('actions.scheduleVisit')}
              </Button>
            )}
            {isAgentPlus && (
              <Button size="sm" variant="outline" onClick={() => setSellOpen(true)}>
                <BadgeDollarSign className="size-4" />
                {t('actions.recordSale')}
              </Button>
            )}
            {/* El alta de vehículos vive en el Inventario, que es de admin. */}
            {isAdmin && (
              <Link
                href={`/inventory?nuevo=1&vendedor=${contact.id}`}
                className="border-border hover:bg-muted text-foreground inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-sm font-medium"
              >
                <CarFront className="size-4" />
                {t('actions.recordPurchase')}
              </Link>
            )}
            {canEdit && contact.phone && (
              <Button size="sm" onClick={() => setTemplateOpen(true)} disabled={sendingTemplate}>
                {sendingTemplate ? <Loader2 className="size-4 animate-spin" /> : <LayoutTemplate className="size-4" />}
                {tDetail('sendTemplateBtn')}
              </Button>
            )}
          </div>
        </div>

        {/* Resumen */}
        <dl className="border-border mt-4 grid grid-cols-2 gap-3 border-t pt-4 sm:grid-cols-4 lg:grid-cols-7">
          {stats.map(([label, value]) => (
            <div key={label} className="min-w-0">
              <dt className="text-muted-foreground truncate text-xs">{label}</dt>
              <dd className="text-foreground text-sm font-semibold">{value}</dd>
            </div>
          ))}
        </dl>
      </div>

      {/* Cuerpo: resumen editable a la izquierda, hoja de vida a la derecha.
          En pantallas angostas se apilan. */}
      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="min-w-0 space-y-4">
          {!canEdit && (
            <p className="text-muted-foreground border-border rounded-lg border border-dashed p-3 text-xs">
              {t('readOnlyNotice')}
            </p>
          )}
          <section className="border-border bg-card space-y-3 rounded-xl border p-4">
            <h2 className="text-foreground text-sm font-medium">{tDetail('contactInfo')}</h2>
            <ContactDetailsForm key={contact.updated_at} contact={contact} readOnly={!canEdit} onSaved={load} />
          </section>
          <section className="border-border bg-card space-y-3 rounded-xl border p-4">
            <h2 className="text-foreground text-sm font-medium">{tDetail('tabs.tags')}</h2>
            <ContactTagsEditor contactId={contact.id} readOnly={!canEdit} />
          </section>
          <section className="border-border bg-card space-y-3 rounded-xl border p-4">
            <h2 className="text-foreground text-sm font-medium">{tDetail('customFields')}</h2>
            <ContactCustomFieldsForm contactId={contact.id} readOnly={!canEdit} />
          </section>
        </aside>

        <section className="border-border bg-card min-w-0 rounded-xl border p-4">
          <Tabs defaultValue="timeline">
            <TabsList>
              <TabsTrigger value="timeline">{t('tabs.timeline')}</TabsTrigger>
              <TabsTrigger value="documents">{t('tabs.documents')}</TabsTrigger>
            </TabsList>
            <TabsContent value="timeline" className="mt-4 space-y-4">
              {isAgentPlus && <ContactNoteBox contactId={contact.id} onAdded={refresh} />}
              <ContactTimeline
                contactId={contact.id}
                reloadKey={timelineKey}
                canEdit={canEdit}
                onOpenThread={setThreadId}
                onEditInteraction={(e) => {
                  setEditingInteraction(e);
                  setInteractionOpen(true);
                }}
              />
            </TabsContent>
            <TabsContent value="documents" className="mt-4">
              <ContactDocuments contactId={contact.id} accountId={contact.account_id} readOnly={!canEdit} />
            </TabsContent>
          </Tabs>
        </section>
      </div>

      <ContactThreadViewer contactId={contact.id} conversationId={threadId} onClose={() => setThreadId(null)} />
      <InteractionDialog
        open={interactionOpen}
        onOpenChange={setInteractionOpen}
        contactId={contact.id}
        editing={editingInteraction}
        onSaved={refresh}
      />
      {sellOpen && (
        <SellVehicleDialog
          open
          onOpenChange={setSellOpen}
          buyer={{ id: contact.id, name: contact.name ?? null }}
          onSold={refresh}
        />
      )}
      {scheduleOpen && (
        <ScheduleVisitDialog
          contactId={contact.id}
          conversationId={myThread?.conversation_id ?? null}
          agentId={myThread?.agent_id ?? null}
          onClose={() => setScheduleOpen(false)}
          onSaved={refresh}
        />
      )}
      <TemplatePicker
        open={templateOpen}
        onOpenChange={setTemplateOpen}
        onSelect={sendTemplate}
        contactName={contact.name}
      />
    </div>
  );
}
