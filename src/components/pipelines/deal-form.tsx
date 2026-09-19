"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { CURRENCIES } from "@/lib/currency";
import {
  applyVehicleSelection,
  formatVehicleTitle,
  pickDefaultPipeline,
  type VehicleInquiryRef,
} from "@/lib/pipelines/deal-vehicle";
import type {
  Contact,
  Conversation,
  Deal,
  DealStatus,
  DealVehicle,
  Pipeline,
  PipelineStage,
  Profile,
} from "@/types";
import { VehiclePicker } from "@/components/pipelines/vehicle-picker";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Check,
  X,
  Trash2,
  MessageSquare,
  DollarSign,
  Loader2,
  User,
} from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";

interface DealFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deal?: Deal | null;
  /**
   * Embudo fijo (tablero). Si no viene, el formulario carga los embudos de la
   * cuenta, propone uno con `pickDefaultPipeline` y deja elegirlo.
   */
  pipelineId?: string;
  /** Etapas del embudo fijo. Va junto con `pipelineId`. */
  stages?: PipelineStage[];
  defaultStageId?: string;
  /**
   * Contacto fijo (bandeja): se muestra su nombre, no se puede cambiar y no se
   * carga la lista de contactos de la cuenta.
   */
  fixedContactId?: string;
  onSaved: () => void;
}

/** Columnas del vehículo que usa el selector (ver `DealVehicle`). */
const VEHICLE_COLUMNS = "id, brand, model, year, license_plate, price, status";

export function DealForm({
  open,
  onOpenChange,
  deal,
  pipelineId: pipelineIdProp,
  stages: stagesProp,
  defaultStageId,
  fixedContactId,
  onSaved,
}: DealFormProps) {
  const t = useTranslations("Pipelines.form");
  const supabase = createClient();
  const { accountId, defaultCurrency } = useAuth();

  // Sin embudo fijo, el formulario elige embudo por su cuenta.
  const managesPipeline = !pipelineIdProp;
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [ownPipelineId, setOwnPipelineId] = useState("");
  const [ownStages, setOwnStages] = useState<PipelineStage[]>([]);
  const pipelineId = pipelineIdProp || ownPipelineId;
  const stages = stagesProp ?? ownStages;
  // Cada carga de etapas toma un número; una respuesta vieja (se cambió de
  // embudo mientras tanto) se descarta.
  const stagesSeqRef = useRef(0);

  const [fixedContact, setFixedContact] = useState<Pick<
    Contact,
    "id" | "name" | "phone"
  > | null>(null);

  const [vehicles, setVehicles] = useState<DealVehicle[]>([]);
  const [inquiries, setInquiries] = useState<VehicleInquiryRef[]>([]);
  const [vehicleId, setVehicleId] = useState("");
  /** Título que puso el último vehículo elegido (ver `applyVehicleSelection`). */
  const [autoTitle, setAutoTitle] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [value, setValue] = useState("");
  const [currency, setCurrency] = useState(defaultCurrency);
  const [contactId, setContactId] = useState("");
  const [stageId, setStageId] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [expectedCloseDate, setExpectedCloseDate] = useState("");
  const [notes, setNotes] = useState("");

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [linkedConversation, setLinkedConversation] =
    useState<Conversation | null>(null);

  const [saving, setSaving] = useState(false);
  const [statusAction, setStatusAction] = useState<DealStatus | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Reset the form fields every time the sheet opens or its input
  // props change. This is a legitimate prop-driven sync; the rule is
  // over-cautious here, hence the block-level disable.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!open) return;
    setConfirmDelete(false);
    if (deal) {
      setTitle(deal.title);
      setValue(String(deal.value ?? ""));
      setCurrency(deal.currency || defaultCurrency);
      // contact_id is nullable when the contact has been deleted
      // (migration 004: ON DELETE SET NULL). "" means "no selection".
      setContactId(deal.contact_id ?? "");
      setStageId(deal.stage_id);
      setAssignedTo(deal.assigned_to ?? "");
      setExpectedCloseDate(deal.expected_close_date ?? "");
      setNotes(deal.notes ?? "");
      setVehicleId(deal.vehicle_id ?? "");
    } else {
      setTitle("");
      setValue("");
      setCurrency(defaultCurrency);
      setContactId(fixedContactId ?? "");
      // Con embudo propio, la etapa la pone la carga de embudos (abajo).
      setStageId(defaultStageId || stagesProp?.[0]?.id || "");
      setAssignedTo("");
      setExpectedCloseDate("");
      setNotes("");
      setVehicleId("");
    }
    // Al editar un negocio con vehículo, su "Marca Modelo Año" cuenta como
    // título autollenado: si el título sigue siendo ese, cambiar de vehículo
    // lo reemplaza; si el asesor lo cambió, se respeta.
    setAutoTitle(deal?.vehicle ? formatVehicleTitle(deal.vehicle) : null);
  }, [open, deal, defaultStageId, stagesProp, defaultCurrency, fixedContactId]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Load supporting data once the sheet is open
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const [c, p] = await Promise.all([
        // Con contacto fijo solo hace falta su nombre, no la lista entera.
        fixedContactId
          ? supabase
              .from("contacts")
              .select("id, name, phone")
              .eq("id", fixedContactId)
              .maybeSingle()
          : supabase.from("contacts").select("*").order("name"),
        supabase.from("profiles").select("*").order("full_name"),
      ]);
      if (cancelled) return;
      if (fixedContactId) {
        setFixedContact(
          (c.data as Pick<Contact, "id" | "name" | "phone"> | null) ?? null,
        );
        setContacts([]);
      } else {
        setFixedContact(null);
        setContacts((c.data ?? []) as Contact[]);
      }
      setProfiles((p.data ?? []) as Profile[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, supabase, fixedContactId]);

  // Inventario ofrecible (disponibles y reservados), una vez por apertura. Si
  // el negocio que se edita tiene un vehículo que ya no lo es (vendido u
  // oculto), se trae aparte para que siga viéndose como el elegido.
  const linkedVehicleId = deal?.vehicle_id ?? null;
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("inventory_vehicles")
        .select(VEHICLE_COLUMNS)
        .in("status", ["available", "reserved"]);
      let list = (data ?? []) as DealVehicle[];
      if (linkedVehicleId && !list.some((v) => v.id === linkedVehicleId)) {
        const { data: linked } = await supabase
          .from("inventory_vehicles")
          .select(VEHICLE_COLUMNS)
          .eq("id", linkedVehicleId)
          .maybeSingle();
        if (linked) list = [...list, linked as DealVehicle];
      }
      if (cancelled) return;
      setVehicles(list);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, supabase, linkedVehicleId]);

  // Lo que el contacto consultó desde la vitrina: son los sugeridos.
  useEffect(() => {
    if (!open || !contactId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setInquiries([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("vehicle_inquiries")
        .select("vehicle_id, created_at")
        .eq("contact_id", contactId)
        .order("created_at", { ascending: false })
        .limit(100);
      if (cancelled) return;
      setInquiries((data ?? []) as VehicleInquiryRef[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, contactId, supabase]);

  /**
   * Carga las etapas de un embudo (modo sin embudo fijo) y pone la etapa:
   * `keepStageId` si es de ese embudo, o la de menor posición.
   */
  const loadOwnStages = useCallback(
    async (targetPipelineId: string, keepStageId?: string) => {
      const seq = ++stagesSeqRef.current;
      const { data } = await supabase
        .from("pipeline_stages")
        .select("*")
        .eq("pipeline_id", targetPipelineId)
        .order("position");
      if (seq !== stagesSeqRef.current) return;
      const list = (data ?? []) as PipelineStage[];
      setOwnStages(list);
      setStageId(
        keepStageId && list.some((s) => s.id === keepStageId)
          ? keepStageId
          : (list[0]?.id ?? ""),
      );
    },
    [supabase],
  );

  // Sin embudo fijo: cargar los embudos de la cuenta y proponer uno (el del
  // negocio al editar; si no, "Ventas" o el más antiguo).
  const dealPipelineId = deal?.pipeline_id;
  const dealStageId = deal?.stage_id;
  useEffect(() => {
    if (!open || !managesPipeline) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("pipelines")
        .select("*")
        .order("created_at");
      if (cancelled) return;
      const list = (data ?? []) as Pipeline[];
      setPipelines(list);
      const initial =
        list.find((p) => p.id === dealPipelineId) ?? pickDefaultPipeline(list);
      setOwnPipelineId(initial?.id ?? "");
      if (initial) {
        await loadOwnStages(initial.id, dealStageId);
      } else {
        setOwnStages([]);
        setStageId("");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, managesPipeline, supabase, dealPipelineId, dealStageId, loadOwnStages]);

  function handlePipelineChange(nextPipelineId: string) {
    setOwnPipelineId(nextPipelineId);
    setOwnStages([]);
    setStageId("");
    if (nextPipelineId) void loadOwnStages(nextPipelineId);
  }

  function handleVehicleChange(vehicle: DealVehicle | null) {
    if (!vehicle) {
      // Quitar el vehículo no toca ni el título ni el valor.
      setVehicleId("");
      return;
    }
    const next = applyVehicleSelection({ title, autoTitle }, vehicle);
    setVehicleId(vehicle.id);
    setTitle(next.title);
    setAutoTitle(next.autoTitle);
    setValue(String(next.value));
  }

  // Fetch linked conversation for the selected contact (newest open one).
  // Clearing on no-selection is sync with prop state; the populated
  // case runs setLinkedConversation inside the async fetch callback.
  useEffect(() => {
    if (!open || !contactId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLinkedConversation(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("conversations")
        .select("*")
        .eq("contact_id", contactId)
        .order("last_message_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      setLinkedConversation((data as Conversation | null) ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, contactId, supabase]);

  async function handleSave() {
    if (!title.trim() || !contactId || !stageId || !pipelineId) {
      toast.error(t("toastRequired"));
      return;
    }
    setSaving(true);

    const payload = {
      title: title.trim(),
      value: parseFloat(value) || 0,
      currency,
      contact_id: contactId,
      pipeline_id: pipelineId,
      stage_id: stageId,
      assigned_to: assignedTo || null,
      notes: notes.trim() || null,
      expected_close_date: expectedCloseDate || null,
      vehicle_id: vehicleId || null,
    };

    if (deal) {
      const { error } = await supabase
        .from("deals")
        .update(payload)
        .eq("id", deal.id);
      if (error) {
        toast.error(t("toastFailedSave"));
        setSaving(false);
        return;
      }
    } else {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) {
        toast.error(t("toastNotSignedIn"));
        setSaving(false);
        return;
      }
      if (!accountId) {
        toast.error(t("toastNotLinked"));
        setSaving(false);
        return;
      }
      const { error } = await supabase
        .from("deals")
        .insert({ ...payload, user_id: user.id, account_id: accountId, status: "open" });
      if (error) {
        toast.error(t("toastFailedCreate"));
        setSaving(false);
        return;
      }
    }

    setSaving(false);
    toast.success(deal ? t("toastUpdated") : t("toastCreated"));
    onOpenChange(false);
    onSaved();
  }

  async function handleStatusChange(status: DealStatus) {
    if (!deal) return;
    setStatusAction(status);
    const { error } = await supabase
      .from("deals")
      .update({ status })
      .eq("id", deal.id);
    setStatusAction(null);
    if (error) {
      toast.error(t("toastFailedStatus"));
      return;
    }
    toast.success(
      status === "won" ? t("toastMarkedWon") : status === "lost" ? t("toastMarkedLost") : t("toastReopened"),
    );
    onOpenChange(false);
    onSaved();
  }

  async function handleDelete() {
    if (!deal) return;
    setDeleting(true);
    const { error } = await supabase.from("deals").delete().eq("id", deal.id);
    setDeleting(false);
    if (error) {
      toast.error(t("toastFailedDelete"));
      return;
    }
    toast.success(t("toastDeleted"));
    setConfirmDelete(false);
    onOpenChange(false);
    onSaved();
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="bg-popover border-border text-popover-foreground sm:max-w-lg w-full p-0"
      >
        <div className="flex h-full flex-col">
          <SheetHeader className="border-b border-border/50 p-4">
            <SheetTitle className="text-popover-foreground">
              {deal ? t("editDeal") : t("newDeal")}
            </SheetTitle>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            <div className="grid gap-2">
              <Label className="text-muted-foreground">{t("title")}</Label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t("titlePlaceholder")}
                className="border-border bg-muted text-foreground"
              />
            </div>

            <div className="grid gap-2">
              <Label className="text-muted-foreground">{t("contact")}</Label>
              {fixedContactId ? (
                // Abierto desde la conversación: el contacto no se cambia.
                <div className="flex h-9 w-full items-center gap-2 rounded-lg border border-border bg-muted/50 px-2.5 text-sm text-foreground">
                  <User className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate">
                    {/* El panel no se remonta al cambiar de conversación: sin
                        este id se vería un instante el contacto anterior. */}
                    {fixedContact && fixedContact.id === fixedContactId
                      ? fixedContact.name || fixedContact.phone || "—"
                      : "…"}
                  </span>
                </div>
              ) : (
                <select
                  value={contactId}
                  onChange={(e) => setContactId(e.target.value)}
                  className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                >
                  <option value="">{t("selectContact")}</option>
                  {contacts.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name || c.phone}
                    </option>
                  ))}
                </select>
              )}

              {/* Desde la bandeja ya se está en la conversación: el enlace sobra. */}
              {linkedConversation && !fixedContactId && (
                <Link
                  href="/inbox"
                  className="mt-1 inline-flex items-center gap-1.5 self-start rounded-md bg-primary/10 px-2 py-1 text-xs text-primary hover:bg-primary/20"
                >
                  <MessageSquare className="h-3 w-3" />
                  {t("linkToConversation")}
                </Link>
              )}
            </div>

            <div className="grid gap-2">
              <Label htmlFor="deal-vehicle" className="text-muted-foreground">
                {t("vehicle")}
              </Label>
              <VehiclePicker
                id="deal-vehicle"
                vehicles={vehicles}
                inquiries={inquiries}
                value={vehicleId}
                fallbackSelected={
                  deal?.vehicle && deal.vehicle.id === vehicleId
                    ? deal.vehicle
                    : null
                }
                onChange={handleVehicleChange}
                currency={defaultCurrency}
                labels={{
                  placeholder: t("vehiclePlaceholder"),
                  none: t("vehicleNone"),
                  search: t("vehicleSearch"),
                  empty: t("vehicleEmpty"),
                  suggested: t("vehicleSuggested"),
                  inventory: t("vehicleInventory"),
                  status: {
                    reserved: t("vehicleReserved"),
                    sold: t("vehicleSold"),
                    hidden: t("vehicleHidden"),
                  },
                }}
              />
              <p className="text-[11px] text-muted-foreground">
                {t("vehicleHint")}
              </p>
            </div>

            <div className="grid grid-cols-[1fr_110px] gap-3">
              <div className="grid gap-2">
                <Label className="text-muted-foreground">{t("value")}</Label>
                <div className="relative">
                  <DollarSign className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    type="number"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    placeholder="0"
                    className="border-border bg-muted pl-7 text-foreground"
                  />
                </div>
              </div>
              <div className="grid gap-2">
                <Label className="text-muted-foreground">{t("currency")}</Label>
                <select
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary"
                >
                  {CURRENCIES.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid gap-2">
              <Label className="text-muted-foreground">{t("expectedCloseDate")}</Label>
              <Input
                type="date"
                value={expectedCloseDate}
                onChange={(e) => setExpectedCloseDate(e.target.value)}
                className="border-border bg-muted text-foreground"
              />
            </div>

            {managesPipeline && (
              <div className="grid gap-2">
                <Label className="text-muted-foreground">{t("pipeline")}</Label>
                {pipelines.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    {t("noPipelines")}
                  </p>
                ) : (
                  <select
                    value={ownPipelineId}
                    onChange={(e) => handlePipelineChange(e.target.value)}
                    className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary"
                  >
                    {pipelines.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )}

            <div className="grid gap-2">
              <Label className="text-muted-foreground">{t("stage")}</Label>
              <select
                value={stageId}
                onChange={(e) => setStageId(e.target.value)}
                className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary"
              >
                {stages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid gap-2">
              <Label className="text-muted-foreground">{t("assignedTo")}</Label>
              <select
                value={assignedTo}
                onChange={(e) => setAssignedTo(e.target.value)}
                className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary"
              >
                <option value="">{t("unassigned")}</option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.full_name || p.email}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid gap-2">
              <Label className="text-muted-foreground">{t("notes")}</Label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={t("notesPlaceholder")}
                className="min-h-[100px] border-border bg-muted text-foreground"
              />
            </div>

            {deal && (
              <div className="space-y-2 rounded-lg border border-border bg-muted/50 p-3">
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  {t("status")}
                </p>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    onClick={() => handleStatusChange("won")}
                    disabled={!!statusAction || deal.status === "won"}
                    className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                  >
                    {statusAction === "won" ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <>
                        <Check className="mr-1 h-4 w-4" />
                        {t("markAsWon")}
                      </>
                    )}
                  </Button>
                  <Button
                    type="button"
                    onClick={() => handleStatusChange("lost")}
                    disabled={!!statusAction || deal.status === "lost"}
                    className="flex-1 bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
                  >
                    {statusAction === "lost" ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <>
                        <X className="mr-1 h-4 w-4" />
                        {t("markAsLost")}
                      </>
                    )}
                  </Button>
                </div>
                {deal.status && deal.status !== "open" && (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => handleStatusChange("open")}
                    disabled={!!statusAction}
                    className="w-full text-muted-foreground hover:text-foreground"
                  >
                    {t("reopenDeal")}
                  </Button>
                )}
              </div>
            )}
          </div>

          <div className="border-t border-border/50 bg-popover/80 p-4">
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                className="flex-1 border-border bg-transparent text-muted-foreground hover:bg-muted"
              >
                {t("cancel")}
              </Button>
              <Button
                onClick={handleSave}
                disabled={
                  saving || !title.trim() || !contactId || !stageId || !pipelineId
                }
                className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {saving ? t("saving") : deal ? t("saveChanges") : t("createDeal")}
              </Button>
            </div>

            {deal &&
              (confirmDelete ? (
                <div className="mt-3 flex items-center justify-between gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs">
                  <span className="text-red-300">{t("deletePrompt")}</span>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(false)}
                      disabled={deleting}
                      className="rounded px-2 py-1 text-muted-foreground hover:bg-muted"
                    >
                      {t("cancel")}
                    </button>
                    <button
                      type="button"
                      onClick={handleDelete}
                      disabled={deleting}
                      className="rounded bg-red-600 px-2 py-1 font-medium text-white hover:bg-red-700 disabled:opacity-50"
                    >
                      {deleting ? t("deleting") : t("confirm")}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="mt-3 flex w-full items-center justify-center gap-1 text-xs text-red-400 hover:text-red-300"
                >
                  <Trash2 className="h-3 w-3" />
                  {t("deleteDeal")}
                </button>
              ))}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
