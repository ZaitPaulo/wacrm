'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import {
  ArrowLeft,
  BadgeDollarSign,
  Building2,
  CalendarPlus,
  CarFront,
  Check,
  ChevronDown,
  Copy,
  LayoutTemplate,
  Loader2,
  Mail,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Phone,
  PhoneCall,
  Plus,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { hasMinRole } from '@/lib/auth/roles';
import type { Contact, MessageTemplate } from '@/types';
import type { TimelineEvent } from '@/lib/contacts/timeline';
import type { ContactSummary } from '@/lib/contacts/summary';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLinkItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ChannelBadge } from '@/components/inbox/channel-badge';
import { TemplatePicker, type TemplateSendValues } from '@/components/inbox/template-picker';
import { ScheduleVisitDialog } from '@/components/agenda/schedule-visit-button';
import { ContactDetailsForm } from '@/components/contacts/contact-details-form';
import { ContactTagsEditor } from '@/components/contacts/contact-tags-editor';
import { ContactCustomFieldsForm } from '@/components/contacts/contact-custom-fields-form';
import { ContactDocuments } from '@/components/contacts/contact-documents';
import { ContactQuickLog } from '@/components/contacts/contact-quick-log';
import { ContactStatusStrip } from '@/components/contacts/contact-status-strip';
import { ContactTimeline } from '@/components/contacts/contact-timeline';
import { ContactThreadViewer } from '@/components/contacts/contact-thread-viewer';
import { InteractionDialog } from '@/components/contacts/interaction-dialog';
import { SellVehicleDialog } from '@/components/inventory/sell-vehicle-dialog';

type MobileTab = 'history' | 'data' | 'documents';
const MOBILE_TABS: MobileTab[] = ['history', 'data', 'documents'];

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
 * Arriba, quién es y las tres acciones del día a día (el resto en "Más");
 * debajo, "Cómo va" (pendiente, próxima cita, negocio, último contacto) y
 * la historia con el registro rápido encima. Los datos se LEEN en la
 * columna lateral y se editan con "Editar". En el celular las columnas
 * pasan a pestañas y las acciones a una barra fija abajo.
 *
 * VER es de todo el equipo (migraciones 553 y 555): cualquier miembro
 * abre la ficha de cualquier contacto de su cuenta. ATENDER sigue siendo
 * del asignado: editar los datos, enviar una plantilla, abrir el chat y
 * agendar se ofrecen solo si `can_edit`, que es la misma regla de la
 * base. Notas e interacciones, a todo `agent` o superior.
 */
export default function ContactProfilePage() {
  const { id } = useParams<{ id: string }>();
  const t = useTranslations('Contacts.profile');
  const tDetail = useTranslations('Contacts.detailView');
  const tChannel = useTranslations('Inbox.channels');
  const { user, accountRole, defaultCurrency } = useAuth();
  const isAgentPlus = !!accountRole && hasMinRole(accountRole, 'agent');
  const isAdmin = !!accountRole && hasMinRole(accountRole, 'admin');

  const [contact, setContact] = useState<Contact | null>(null);
  const [summary, setSummary] = useState<ContactSummary | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'notFound'>('loading');
  const [timelineKey, setTimelineKey] = useState(0);
  const [copied, setCopied] = useState(false);
  const [mobileTab, setMobileTab] = useState<MobileTab>('history');
  const [editingData, setEditingData] = useState(false);

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
  // "Agendar visita" y "Abrir chat": la conversación que atiende quien
  // mira o, para admin, la más reciente; de ahí sale la confirmación al
  // cliente.
  const myThread = summary.agents.find((a) => a.agent_id === user?.id) ?? summary.agents[0] ?? null;
  const telHref = contact.phone ? `tel:${contact.phone.startsWith('+') ? '' : '+'}${contact.phone}` : null;

  const openNewInteraction = () => {
    setEditingInteraction(null);
    setInteractionOpen(true);
  };
  // Quien atiende va al chat de la bandeja; los demás lo leen aquí, en
  // solo lectura (la bandeja no se lo mostraría).
  const openChat = () => myThread && setThreadId(myThread.conversation_id);
  const chatHref = canEdit && myThread ? `/inbox?c=${myThread.conversation_id}` : null;

  const showOnMobile = (tab: MobileTab) => (mobileTab === tab ? 'flex' : 'hidden lg:flex');

  /** Lo que no es del día a día. Mismas reglas que antes. */
  const moreItems = (
    <>
      {isAgentPlus && (
        <DropdownMenuItem onClick={() => setSellOpen(true)}>
          <BadgeDollarSign />
          {t('actions.recordSale')}
        </DropdownMenuItem>
      )}
      {/* El alta de vehículos vive en el Inventario, que es de admin. */}
      {isAdmin && (
        <DropdownMenuLinkItem render={<Link href={`/inventory?nuevo=1&vendedor=${contact.id}`} />}>
          <CarFront />
          <span className="flex-1">{t('actions.recordPurchase')}</span>
          <span className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-[10px] font-semibold">
            {t('actions.adminOnly')}
          </span>
        </DropdownMenuLinkItem>
      )}
      {canEdit && contact.phone && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setTemplateOpen(true)} disabled={sendingTemplate}>
            <LayoutTemplate />
            {tDetail('sendTemplateBtn')}
          </DropdownMenuItem>
        </>
      )}
    </>
  );
  const hasMore = isAgentPlus || isAdmin || (canEdit && !!contact.phone);

  const stats: [string, number, string | null][] = [
    [t('stats.appointments'), summary.appointments_total, summary.appointments_total > 0 ? t('statsAttended', { count: summary.appointments_attended }) : null],
    [t('stats.openDeals'), summary.open_deals, null],
    [t('stats.bought'), summary.vehicles_bought, null],
    [t('stats.purchased'), summary.vehicles_purchased, null],
  ];
  // Retomas y consignaciones son raras: solo ocupan lugar cuando las hay.
  if (summary.vehicles_traded_in > 0) stats.push([t('stats.tradedIn'), summary.vehicles_traded_in, null]);
  if (summary.consignments > 0) stats.push([t('stats.consignments'), summary.consignments, null]);

  return (
    <div className="mx-auto w-full max-w-6xl space-y-4 pb-24 md:pb-0">
      <Link href="/contacts" className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm">
        <ArrowLeft className="size-4" />
        {t('backToContacts')}
      </Link>

      {/* Encabezado: quién es, quién lo atiende y las acciones del día a día */}
      <header className="border-border bg-card flex flex-col gap-4 rounded-xl border p-4 md:flex-row md:items-start md:justify-between md:p-5">
        <div className="flex min-w-0 items-start gap-3 md:gap-4">
          <Avatar className="bg-muted border-border size-12 shrink-0 border md:size-14">
            <AvatarFallback className="bg-primary/10 text-primary text-base font-semibold">
              {initials(contact.name)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 space-y-2">
            <h1 className="text-foreground truncate text-xl font-bold md:text-2xl">{contact.name || tDetail('unnamed')}</h1>
            <div className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              {contact.phone && (
                <button
                  type="button"
                  onClick={copyPhone}
                  className="hover:text-primary flex items-center gap-1.5"
                  aria-label={contact.phone}
                >
                  <Phone className="size-3.5" />
                  {contact.phone}
                  {copied ? <Check className="text-primary size-3.5" /> : <Copy className="size-3.5 opacity-60" />}
                </button>
              )}
              {contact.email && (
                <span className="flex items-center gap-1.5 break-all">
                  <Mail className="size-3.5" />
                  {contact.email}
                </span>
              )}
              {contact.company && (
                <span className="flex items-center gap-1.5">
                  <Building2 className="size-3.5" />
                  {contact.company}
                </span>
              )}
            </div>
            {/* Canales y quién atiende cada uno. */}
            <div className="flex flex-wrap gap-2">
              {summary.agents.length === 0 ? (
                <span className="text-muted-foreground text-xs">{t('noConversations')}</span>
              ) : (
                summary.agents.map((a) => {
                  const mine = !!user && a.agent_id === user.id;
                  const channel = tChannel(a.channel);
                  return (
                    <span
                      key={a.conversation_id}
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium',
                        mine
                          ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300'
                          : 'bg-muted text-foreground'
                      )}
                    >
                      <ChannelBadge channel={a.channel} />
                      {mine
                        ? t('channelYou', { channel })
                        : a.agent_name
                          ? t('channelAgent', { channel, name: a.agent_name })
                          : t('channelNone', { channel })}
                    </span>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* Acciones de escritorio; en el celular van en la barra de abajo.
            Solo se ofrece lo que la base va a permitir. */}
        <div className="hidden flex-wrap gap-2 md:flex md:justify-end">
          {myThread &&
            (chatHref ? (
              <Link
                href={chatHref}
                className="border-border hover:bg-muted text-foreground inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm font-medium"
              >
                <MessageSquare className="size-4" />
                {t('actions.openChat')}
              </Link>
            ) : (
              <Button variant="outline" onClick={openChat}>
                <MessageSquare className="size-4" />
                {t('actions.openChat')}
              </Button>
            ))}
          {isAgentPlus && (
            <Button variant="outline" onClick={openNewInteraction}>
              <PhoneCall className="size-4" />
              {t('actions.logCall')}
            </Button>
          )}
          {canEdit && (
            <Button onClick={() => setScheduleOpen(true)}>
              <CalendarPlus className="size-4" />
              {t('actions.scheduleVisit')}
            </Button>
          )}
          {hasMore && (
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="outline" />}>
                {t('actions.more')}
                <ChevronDown className="size-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-56">
                {moreItems}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </header>

      {!canEdit && (
        <p className="border-border bg-muted/40 text-muted-foreground rounded-lg border p-3 text-sm">
          {t('readOnlyNotice')}
        </p>
      )}

      <ContactStatusStrip summary={summary} myUserId={user?.id ?? null} isAdmin={isAdmin} currency={defaultCurrency} />

      {/* En el celular, las columnas pasan a pestañas. */}
      <div role="tablist" className="border-border bg-card flex rounded-lg border p-1 lg:hidden">
        {MOBILE_TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={mobileTab === tab}
            onClick={() => setMobileTab(tab)}
            className={cn(
              'h-10 flex-1 rounded-md text-sm font-medium transition-colors',
              mobileTab === tab ? 'bg-primary/10 text-primary' : 'text-muted-foreground'
            )}
          >
            {t(`mobileTabs.${tab}`)}
          </button>
        ))}
      </div>

      <div className="grid min-w-0 grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        {/* Historia: registrar arriba, la línea de tiempo por día abajo */}
        <section
          className={cn('border-border bg-card min-w-0 flex-col gap-4 rounded-xl border p-4 md:p-5', showOnMobile('history'))}
        >
          <h2 className="text-foreground text-lg font-semibold">{t('sections.history')}</h2>
          {isAgentPlus && (
            <ContactQuickLog contactId={contact.id} onSaved={refresh} onMoreDetails={openNewInteraction} />
          )}
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
        </section>

        {/* Columna lateral: los datos se leen; editar es un clic */}
        <aside className="flex min-w-0 flex-col gap-4">
          <section className={cn('border-border bg-card flex-col gap-4 rounded-xl border p-4 md:p-5', showOnMobile('data'))}>
            <div className="flex items-center justify-between">
              <h2 className="text-foreground text-base font-semibold">{t('sections.data')}</h2>
              {canEdit && (
                <button
                  type="button"
                  onClick={() => setEditingData((v) => !v)}
                  className="text-primary inline-flex items-center gap-1.5 text-sm font-medium hover:underline"
                >
                  {editingData ? <Check className="size-3.5" /> : <Pencil className="size-3.5" />}
                  {editingData ? t('sections.done') : t('sections.edit')}
                </button>
              )}
            </div>
            <ContactDetailsForm
              key={contact.updated_at}
              contact={contact}
              readOnly={!canEdit || !editingData}
              onSaved={() => {
                setEditingData(false);
                void load();
              }}
            />
            <div className="border-border space-y-2 border-t pt-4">
              <h3 className="text-muted-foreground text-xs font-medium">{tDetail('customFields')}</h3>
              <ContactCustomFieldsForm contactId={contact.id} readOnly={!canEdit || !editingData} />
            </div>
            <div className="border-border space-y-2 border-t pt-4">
              <h3 className="text-muted-foreground text-xs font-medium">{t('sections.tags')}</h3>
              <ContactTagsEditor contactId={contact.id} readOnly={!canEdit} />
            </div>
          </section>

          <section className={cn('border-border bg-card flex-col gap-3 rounded-xl border p-4 md:p-5', showOnMobile('data'))}>
            <h2 className="text-foreground text-base font-semibold">{t('sections.withUs')}</h2>
            <dl className="grid grid-cols-2 gap-2.5">
              {stats.map(([label, value, sub]) => (
                <div key={label} className="bg-muted/50 flex min-w-0 flex-col-reverse rounded-lg p-3">
                  <dt className="text-muted-foreground text-xs font-medium">{sub ? `${label} · ${sub}` : label}</dt>
                  <dd className="text-foreground text-xl font-bold">{value}</dd>
                </div>
              ))}
            </dl>
            {summary.vehicles_traded_in === 0 && summary.consignments === 0 && (
              <p className="text-muted-foreground text-xs">{t('statsEmptyHint')}</p>
            )}
          </section>

          <section className={cn('border-border bg-card flex-col gap-3 rounded-xl border p-4 md:p-5', showOnMobile('documents'))}>
            <h2 className="text-foreground text-base font-semibold">{t('sections.documents')}</h2>
            <ContactDocuments contactId={contact.id} accountId={contact.account_id} readOnly={!canEdit} />
          </section>
        </aside>
      </div>

      {/* Barra de acciones del celular */}
      <nav
        aria-label={t('mobileBar.label')}
        className="border-border bg-card fixed inset-x-0 bottom-0 z-20 flex border-t px-2 pt-1.5 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:hidden"
      >
        {myThread &&
          (chatHref ? (
            <Link href={chatHref} className={barItem}>
              <MessageSquare className="size-5" />
              {t('mobileBar.chat')}
            </Link>
          ) : (
            <button type="button" onClick={openChat} className={barItem}>
              <MessageSquare className="size-5" />
              {t('mobileBar.chat')}
            </button>
          ))}
        {telHref && (
          <a href={telHref} className={barItem}>
            <Phone className="size-5" />
            {t('mobileBar.call')}
          </a>
        )}
        {isAgentPlus && (
          <button type="button" onClick={openNewInteraction} className={barItem}>
            <span className="bg-primary text-primary-foreground -mt-5 flex size-12 items-center justify-center rounded-full shadow-lg">
              <Plus className="size-5" />
            </span>
            {t('mobileBar.log')}
          </button>
        )}
        {canEdit && (
          <button type="button" onClick={() => setScheduleOpen(true)} className={barItem}>
            <CalendarPlus className="size-5" />
            {t('mobileBar.schedule')}
          </button>
        )}
        {hasMore && (
          <DropdownMenu>
            <DropdownMenuTrigger className={barItem} aria-label={t('actions.more')}>
              <MoreHorizontal className="size-5" />
              {t('mobileBar.more')}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" side="top" className="min-w-56">
              {moreItems}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </nav>

      <ContactThreadViewer contactId={contact.id} conversationId={threadId} onClose={() => setThreadId(null)} />
      <InteractionDialog
        open={interactionOpen}
        onOpenChange={setInteractionOpen}
        contactId={contact.id}
        editing={editingInteraction}
        onSaved={refresh}
        onScheduleNext={canEdit ? () => setScheduleOpen(true) : undefined}
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

const barItem =
  'text-foreground flex min-h-14 flex-1 flex-col items-center justify-center gap-1 text-xs font-medium';
