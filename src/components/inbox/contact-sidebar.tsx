"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { addContactTag, deleteContactTag } from "@/lib/contacts/tag-api";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { getAllowedTargetStages } from "@/lib/pipelines/stage-transitions";
import { formatVehicleLabel } from "@/lib/pipelines/deal-vehicle";
import { DealForm } from "@/components/pipelines/deal-form";
import type {
  Contact,
  Deal,
  ContactNote,
  Tag,
  PipelineStage,
  PipelineStageTransition,
} from "@/types";
import {
  Phone,
  Mail,
  Copy,
  Check,
  User,
  Tag as TagIcon,
  DollarSign,
  StickyNote,
  Plus,
  X,
  ChevronDown,
  Car,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { format } from "date-fns";
import { useTranslations } from "next-intl";

interface ContactSidebarProps {
  contact: Contact | null;
  /**
   * Anula la presentación del contenedor (`w-70` + `border-l`), que está
   * pensada para el panel fijo de escritorio. En móvil este mismo
   * componente se monta dentro de un `Sheet` a pantalla completa, donde
   * ni el ancho fijo ni el borde izquierdo tienen sentido. Opcional: sin
   * ella el panel de escritorio se comporta exactamente igual que antes.
   */
  className?: string;
}

/**
 * Ficha del contacto de la conversación abierta: datos de contacto,
 * etiquetas, negocios y notas, todo editable en el sitio.
 *
 * Se monta en dos lugares distintos, y es el **mismo** componente en los
 * dos — no hay una versión móvil aparte:
 *
 * - En `lg` y más ancho, como panel lateral fijo de la bandeja.
 * - Por debajo de `lg`, dentro de un `Sheet` que abre el header del
 *   hilo. Ahí se le pasa `className` para anular el `w-70` y el
 *   `border-l` que solo tienen sentido en el panel fijo.
 *
 * Carga sus datos (negocios, notas, etiquetas y el nombre de usuario del
 * canal) en un efecto al cambiar de contacto, numerando cada carga para
 * descartar respuestas viejas si se cambia de conversación a mitad de
 * camino.
 */
export function ContactSidebar({ contact, className }: ContactSidebarProps) {
  const tSidebar = useTranslations("Inbox.sidebar");
  const tThread = useTranslations("Inbox.messageThread");

  const { accountId } = useAuth();
  const [copied, setCopied] = useState(false);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [notes, setNotes] = useState<ContactNote[]>([]);
  // Todas las etiquetas de la cuenta + los ids de las que tiene el contacto.
  // Van separadas (no un join) para que el selector pueda pintar tambien las
  // no asignadas y para que el chip aparezca apenas se marca, sin releer.
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [contactTagIds, setContactTagIds] = useState<string[]>([]);
  const [savingTags, setSavingTags] = useState(false);
  const [tagPickerOpen, setTagPickerOpen] = useState(false);
  /** Formulario para crear un negocio con este contacto ya puesto. */
  const [dealFormOpen, setDealFormOpen] = useState(false);
  const [newNote, setNewNote] = useState("");
  const [addingNote, setAddingNote] = useState(false);
  /** Nombre de usuario de WhatsApp, cuando esa persona tiene uno. */
  const [username, setUsername] = useState<string | null>(null);
  // Etapas y reglas de transicion de los embudos de los negocios del
  // contacto: con ellas se calcula a que etapas se puede mover cada negocio
  // desde aqui (las reglas solo aplican en la bandeja, no en el tablero).
  const [pipelineStages, setPipelineStages] = useState<PipelineStage[]>([]);
  const [stageTransitions, setStageTransitions] = useState<
    PipelineStageTransition[]
  >([]);
  /** Negocio cuyo selector de etapa esta abierto (uno a la vez). */
  const [stagePickerDealId, setStagePickerDealId] = useState<string | null>(
    null
  );
  /** Negocio cuya etapa se esta guardando. */
  const [savingStageDealId, setSavingStageDealId] = useState<string | null>(
    null
  );
  // Cada carga toma un numero; si al volver de una consulta ya hay otra
  // carga mas nueva (se cambio de contacto), la respuesta vieja se descarta
  // en vez de pisar los datos del contacto actual.
  const fetchSeqRef = useRef(0);

  const fetchContactData = useCallback(async () => {
    if (!contact) return;

    const supabase = createClient();
    const seq = ++fetchSeqRef.current;

    // Fetch deals, notes, tags — y el nombre de usuario del canal — en
    // paralelo.
    const [dealsRes, notesRes, contactTagsRes, allTagsRes, identitiesRes] =
      await Promise.all([
      supabase
        .from("deals")
        .select(
          "*, pipeline:pipelines(*), stage:pipeline_stages(*), vehicle:inventory_vehicles!deals_vehicle_fkey(id, brand, model, year, license_plate)"
        )
        .eq("contact_id", contact.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("contact_notes")
        .select("*")
        .eq("contact_id", contact.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("contact_tags")
        .select("tag_id")
        .eq("contact_id", contact.id),
        supabase.from("tags").select("*").order("name"),
        // El nombre de usuario de WhatsApp. Es lo único legible que
        // tiene un contacto que no comparte su número, así que sin esto
        // su ficha queda sin un solo identificador que un asesor pueda
        // usar para encontrarlo o para confirmar con quién habla.
        supabase
          .from("contact_channels")
          .select("username")
          .eq("contact_id", contact.id)
          .eq("channel", "whatsapp")
          .not("username", "is", null)
          .limit(1),
      ]);

    if (seq !== fetchSeqRef.current) return;

    if (notesRes.data) setNotes(notesRes.data);
    if (allTagsRes.data) setAllTags(allTagsRes.data);
    if (contactTagsRes.data) {
      setContactTagIds(contactTagsRes.data.map((ct) => ct.tag_id as string));
    }
    setUsername(
      (identitiesRes.data?.[0] as { username?: string } | undefined)
        ?.username ?? null
    );

    if (!dealsRes.data) return;
    const loadedDeals = dealsRes.data as Deal[];

    // Etapas y reglas de los embudos de esos negocios. Sin negocios no hay
    // nada que consultar. Si la consulta de reglas falla (p. ej. la tabla aun
    // no existe), se trata como "sin reglas": el embudo permite cualquier
    // etapa y el panel sigue cargando.
    const pipelineIds = [...new Set(loadedDeals.map((d) => d.pipeline_id))];
    let loadedStages: PipelineStage[] = [];
    let loadedTransitions: PipelineStageTransition[] = [];
    if (pipelineIds.length > 0) {
      const [stagesRes, transitionsRes] = await Promise.all([
        supabase
          .from("pipeline_stages")
          .select("*")
          .in("pipeline_id", pipelineIds)
          .order("position"),
        supabase
          .from("pipeline_stage_transitions")
          .select("*")
          .in("pipeline_id", pipelineIds),
      ]);
      if (seq !== fetchSeqRef.current) return;
      loadedStages = (stagesRes.data as PipelineStage[] | null) ?? [];
      loadedTransitions = transitionsRes.error
        ? []
        : ((transitionsRes.data as PipelineStageTransition[] | null) ?? []);
    }

    // Negocios, etapas y reglas se publican juntos para que la pastilla de
    // etapa no aparezca primero como texto y luego como selector.
    setDeals(loadedDeals);
    setPipelineStages(loadedStages);
    setStageTransitions(loadedTransitions);
  }, [contact]);

  // Load on contact change. setContactData/setTags run inside async
  // Supabase callbacks, not synchronously in the effect body.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchContactData();
  }, [fetchContactData]);

  const handleCopyPhone = useCallback(async () => {
    if (!contact?.phone) return;
    await navigator.clipboard.writeText(contact.phone);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    // Dep is the whole `contact` object (not `contact?.phone`) so the
    // React Compiler's inference agrees with the manual dep list —
    // fixes the `preserve-manual-memoization` lint error.
  }, [contact]);

  // Alta/baja de etiqueta contra la API route: escribir contact_tags directo
  // se saltaria el despacho del evento tag_added que dispara automatizaciones
  // y flujos.
  const handleToggleTag = useCallback(
    async (tagId: string) => {
      if (!contact) return;
      const isAssigned = contactTagIds.includes(tagId);
      setSavingTags(true);
      try {
        if (isAssigned) {
          await deleteContactTag(contact.id, tagId);
          setContactTagIds((prev) => prev.filter((id) => id !== tagId));
        } else {
          await addContactTag(contact.id, tagId);
          setContactTagIds((prev) => [...prev, tagId]);
        }
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : tSidebar("tagUpdateFailed")
        );
      }
      setSavingTags(false);
    },
    [contact, contactTagIds, tSidebar]
  );

  /**
   * Mueve el negocio a otra etapa desde la bandeja. Optimista: la tarjeta
   * cambia al instante y, si la base lo rechaza, vuelve a la etapa anterior.
   * No valida la regla: el selector solo ofrece destinos ya permitidos.
   *
   * @param deal Negocio a mover, tal como está en pantalla.
   * @param target Etapa destino, una de `getAllowedTargetStages`.
   */
  const handleChangeStage = useCallback(
    async (deal: Deal, target: PipelineStage) => {
      const previous = { stage_id: deal.stage_id, stage: deal.stage };
      setStagePickerDealId(null);
      setSavingStageDealId(deal.id);
      setDeals((prev) =>
        prev.map((d) =>
          d.id === deal.id ? { ...d, stage_id: target.id, stage: target } : d
        )
      );

      const supabase = createClient();
      // `.select("id")` para detectar tambien el caso en que la RLS filtra
      // la fila: ahi no hay error, pero no se actualiza nada.
      const { data, error } = await supabase
        .from("deals")
        .update({ stage_id: target.id })
        .eq("id", deal.id)
        .select("id");

      if (error || !data || data.length === 0) {
        setDeals((prev) =>
          prev.map((d) => (d.id === deal.id ? { ...d, ...previous } : d))
        );
        toast.error(tSidebar("stageUpdateFailed"));
      } else {
        toast.success(tSidebar("stageUpdated", { stage: target.name }));
      }
      setSavingStageDealId(null);
    },
    [tSidebar]
  );

  const handleAddNote = useCallback(async () => {
    if (!contact || !newNote.trim()) return;
    if (!accountId) return;
    setAddingNote(true);

    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user;

    const { data, error } = await supabase
      .from("contact_notes")
      .insert({
        contact_id: contact.id,
        account_id: accountId,
        user_id: user?.id,
        note_text: newNote.trim(),
      })
      .select()
      .single();

    if (!error && data) {
      setNotes((prev) => [data, ...prev]);
      setNewNote("");
    }
    setAddingNote(false);
  }, [contact, newNote, accountId]);

  if (!contact) {
    return (
      <div className={cn("flex h-full w-70 items-center justify-center border-l border-border bg-card", className)}>
        <p className="text-sm text-muted-foreground">{tThread("selectConversation")}</p>
      </div>
    );
  }

  // Ni nombre ni teléfono es posible desde la 513; el rótulo
  // igual tiene que existir para la inicial del avatar.
  const displayName = contact.name || contact.phone || "—";
  const initials = displayName.charAt(0).toUpperCase();
  const contactTags = allTags.filter((tag) => contactTagIds.includes(tag.id));

  return (
    <div className={cn("flex h-full w-70 flex-col border-l border-border bg-card", className)}>
      <ScrollArea className="flex-1">
        <div className="p-4">
          {/* Contact Info */}
          <div className="flex flex-col items-center text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted text-lg font-semibold text-foreground">
              {contact.avatar_url ? (
                <img
                  src={contact.avatar_url}
                  alt={displayName}
                  className="h-16 w-16 rounded-full object-cover"
                />
              ) : (
                initials
              )}
            </div>
            <h3 className="mt-3 text-sm font-semibold text-foreground">
              {displayName}
            </h3>
            {contact.company && (
              <p className="text-xs text-muted-foreground">{contact.company}</p>
            )}
          </div>

          {/* Phone */}
          <div className="mt-4 space-y-2">
            {contact.phone ? (
              <button
                onClick={handleCopyPhone}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted"
              >
                <Phone className="h-4 w-4 text-muted-foreground" />
                <span className="flex-1 text-left">{contact.phone}</span>
                {copied ? (
                  <Check className="h-3 w-3 text-primary" />
                ) : (
                  <Copy className="h-3 w-3 text-muted-foreground" />
                )}
              </button>
            ) : (
              /*
               * Sin teléfono. La fila NO se oculta y no se deja en
               * blanco a propósito: un hueco se lee como un dato que
               * falta por cargar, y alguien se pondría a buscarlo. Acá
               * el número no existe y no va a existir — esta persona
               * escribe con su nombre de usuario de WhatsApp y Meta no
               * nos entrega su número.
               */
              <div className="rounded-lg px-3 py-2">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Phone className="h-4 w-4 shrink-0 text-muted-foreground/60" />
                  <span className="flex-1 text-left italic">
                    {tSidebar("noPhone")}
                  </span>
                </div>
                {username && (
                  <div className="mt-1 flex items-center gap-2 pl-6 text-sm">
                    <span className="truncate font-medium">@{username}</span>
                  </div>
                )}
                <p className="mt-1 pl-6 text-xs text-muted-foreground/80">
                  {tSidebar("noPhoneHint")}
                </p>
              </div>
            )}

            {contact.email && (
              <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground">
                <Mail className="h-4 w-4 text-muted-foreground" />
                <span className="truncate">{contact.email}</span>
              </div>
            )}
          </div>

          {/* Divider */}
          <div className="my-4 border-t border-border" />

          {/* Tags */}
          <div>
            <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <TagIcon className="h-3 w-3" />
              <span className="flex-1">{tSidebar("tags")}</span>
              <Popover open={tagPickerOpen} onOpenChange={setTagPickerOpen}>
                <PopoverTrigger
                  className="flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  aria-label={tSidebar("manageTags")}
                >
                  <Plus className="h-3 w-3" />
                </PopoverTrigger>
                <PopoverContent align="end" className="w-64">
                  {allTags.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      {tSidebar("noTagsAvailable")}
                    </p>
                  ) : (
                    <>
                      <p className="text-xs text-muted-foreground">
                        {tSidebar("tagPickerHint")}
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {allTags.map((tag) => {
                          const selected = contactTagIds.includes(tag.id);
                          return (
                            <button
                              key={tag.id}
                              type="button"
                              onClick={() => handleToggleTag(tag.id)}
                              disabled={savingTags}
                              className={cn(
                                "inline-flex cursor-pointer items-center rounded-full px-2 py-0.5 text-[11px] font-medium transition-all disabled:cursor-not-allowed",
                                selected
                                  ? "ring-2 ring-primary ring-offset-1 ring-offset-popover"
                                  : "opacity-50 hover:opacity-80"
                              )}
                              style={{
                                backgroundColor: `${tag.color}20`,
                                color: tag.color,
                              }}
                            >
                              {selected && <Check className="mr-1 h-2.5 w-2.5" />}
                              {tag.name}
                            </button>
                          );
                        })}
                      </div>
                    </>
                  )}
                </PopoverContent>
              </Popover>
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {contactTags.length === 0 ? (
                <p className="px-1 text-xs text-muted-foreground">{tSidebar("noTags")}</p>
              ) : (
                contactTags.map((tag) => (
                  <span
                    key={tag.id}
                    className="inline-flex items-center gap-1 rounded-full py-0.5 pl-2 pr-1 text-[10px] font-medium"
                    style={{
                      backgroundColor: `${tag.color}20`,
                      color: tag.color,
                    }}
                  >
                    {tag.name}
                    <button
                      type="button"
                      onClick={() => handleToggleTag(tag.id)}
                      disabled={savingTags}
                      aria-label={tSidebar("removeTag", { tag: tag.name })}
                      className="flex h-3 w-3 cursor-pointer items-center justify-center rounded-full opacity-60 transition-opacity hover:opacity-100 disabled:cursor-not-allowed"
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </span>
                ))
              )}
            </div>
          </div>

          {/* Divider */}
          <div className="my-4 border-t border-border" />

          {/* Active Deals */}
          <div>
            <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <DollarSign className="h-3 w-3" />
              <span className="flex-1">{tSidebar("deals")}</span>
              <button
                type="button"
                onClick={() => setDealFormOpen(true)}
                className="flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                aria-label={tSidebar("addDeal")}
                title={tSidebar("addDeal")}
              >
                <Plus className="h-3 w-3" />
              </button>
            </div>
            <div className="mt-2 space-y-2">
              {deals.length === 0 ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setDealFormOpen(true)}
                  className="w-full justify-center gap-1.5 border-dashed text-xs text-muted-foreground hover:text-foreground"
                >
                  <Plus className="h-3 w-3" />
                  {tSidebar("createDeal")}
                </Button>
              ) : (
                deals.map((deal) => (
                  <div
                    key={deal.id}
                    className="rounded-lg bg-muted px-3 py-2"
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="text-sm font-medium text-foreground">
                        {deal.title}
                      </p>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {deal.currency ?? "$"}
                        {deal.value.toLocaleString()}
                      </span>
                    </div>
                    {deal.vehicle && (
                      <div
                        className="mt-1 flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground"
                        title={formatVehicleLabel(deal.vehicle)}
                      >
                        <Car className="h-3 w-3 shrink-0" />
                        <span className="truncate">
                          {formatVehicleLabel(deal.vehicle)}
                        </span>
                      </div>
                    )}
                    {/* El embudo del contacto no vive en el contacto: lo lleva
                        el negocio, asi que la ubicacion se lee aqui como
                        "<embudo> · <etapa>". */}
                    {(deal.pipeline || deal.stage) && (
                      <div className="mt-1 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                        {deal.pipeline && (
                          <span className="truncate">{deal.pipeline.name}</span>
                        )}
                        {deal.pipeline && deal.stage && (
                          <span aria-hidden="true">·</span>
                        )}
                        {deal.stage && (
                          <DealStagePill
                            deal={deal}
                            targets={getAllowedTargetStages(
                              deal.stage_id,
                              pipelineStages,
                              stageTransitions
                            )}
                            open={stagePickerDealId === deal.id}
                            onOpenChange={(isOpen) =>
                              setStagePickerDealId(isOpen ? deal.id : null)
                            }
                            saving={savingStageDealId === deal.id}
                            onSelect={(target) =>
                              handleChangeStage(deal, target)
                            }
                          />
                        )}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Divider */}
          <div className="my-4 border-t border-border" />

          {/* Notes */}
          <div>
            <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <StickyNote className="h-3 w-3" />
              {tSidebar("notes")}
            </div>
            <div className="mt-2">
              <div className="flex gap-2">
                <textarea
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  placeholder={tSidebar("addNotePlaceholder")}
                  rows={2}
                  className="flex-1 resize-none rounded-lg border border-border bg-muted px-3 py-2 text-xs text-foreground placeholder-muted-foreground outline-none focus:border-primary/50"
                />
                <Button
                  size="sm"
                  className="h-auto bg-primary px-2 hover:bg-primary/90"
                  onClick={handleAddNote}
                  disabled={!newNote.trim() || addingNote}
                >
                  <Plus className="h-3 w-3" />
                </Button>
              </div>

              <div className="mt-2 space-y-2">
                {notes.map((note) => (
                  <div
                    key={note.id}
                    className="rounded-lg bg-muted px-3 py-2"
                  >
                    <p className="whitespace-pre-wrap text-xs text-muted-foreground">
                      {note.note_text}
                    </p>
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      {format(new Date(note.created_at), "MMM d, yyyy HH:mm")}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </ScrollArea>

      {/* Crear negocio desde la conversacion: contacto fijo y embudo a
          elegir (propone "Ventas"). Al guardar se recarga el panel, que trae
          etapas y reglas, asi la tarjeta sale ya con su selector de etapa. */}
      <DealForm
        open={dealFormOpen}
        onOpenChange={setDealFormOpen}
        fixedContactId={contact.id}
        onSaved={() => {
          void fetchContactData();
        }}
      />
    </div>
  );
}

interface DealStagePillProps {
  deal: Deal;
  /** Etapas a las que se puede mover el negocio desde la bandeja. */
  targets: PipelineStage[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  saving: boolean;
  onSelect: (target: PipelineStage) => void;
}

/**
 * Pastilla con la etapa actual del negocio. Si hay destinos permitidos es el
 * disparador de un selector con esas etapas; si no (etapa final), es solo
 * texto, sin nada que invite a hacer clic.
 */
function DealStagePill({
  deal,
  targets,
  open,
  onOpenChange,
  saving,
  onSelect,
}: DealStagePillProps) {
  const tSidebar = useTranslations("Inbox.sidebar");
  const stage = deal.stage;
  if (!stage) return null;

  const pillStyle = {
    backgroundColor: `${stage.color}20`,
    color: stage.color,
  };

  if (targets.length === 0) {
    return (
      <span className="shrink-0 rounded-full px-1.5 py-0.5" style={pillStyle}>
        {stage.name}
      </span>
    );
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger
        disabled={saving}
        aria-label={tSidebar("changeStageOf", {
          deal: deal.title,
          stage: stage.name,
        })}
        className="inline-flex shrink-0 cursor-pointer items-center gap-0.5 rounded-full py-0.5 pl-1.5 pr-1 outline-none transition-[filter] hover:brightness-110 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-muted disabled:cursor-wait disabled:opacity-60"
        style={pillStyle}
      >
        {stage.name}
        <ChevronDown className="h-2.5 w-2.5" aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 gap-1 p-1.5">
        <p className="px-1.5 pb-0.5 pt-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {tSidebar("moveTo")}
        </p>
        {targets.map((target) => (
          <button
            key={target.id}
            type="button"
            onClick={() => onSelect(target)}
            disabled={saving}
            className="flex w-full cursor-pointer items-center gap-2 rounded-md px-1.5 py-1.5 text-left text-xs text-popover-foreground outline-none transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: target.color }}
              aria-hidden="true"
            />
            <span className="truncate">{target.name}</span>
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}
