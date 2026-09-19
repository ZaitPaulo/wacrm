"use client";

import { useEffect, useState } from "react";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  arrayMove,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { createClient } from "@/lib/supabase/client";
import type {
  Pipeline,
  PipelineStage,
  PipelineStageTransition,
} from "@/types";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Trash2,
  Plus,
  GripVertical,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";

const STAGE_COLORS = [
  "#3b82f6",
  "#6366f1",
  "#8b5cf6",
  "#ec4899",
  "#f43f5e",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#14b8a6",
  "#06b6d4",
];

interface PipelineSettingsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pipeline: Pipeline;
  stages: PipelineStage[];
  onPipelinesChanged: () => void;
  onStagesChanged: () => void;
  onCreateNewPipeline: () => void;
}

export function PipelineSettings({
  open,
  onOpenChange,
  pipeline,
  stages,
  onPipelinesChanged,
  onStagesChanged,
  onCreateNewPipeline,
}: PipelineSettingsProps) {
  const t = useTranslations("Pipelines.settings");
  const supabase = createClient();

  const [name, setName] = useState(pipeline.name);
  const [localStages, setLocalStages] = useState<PipelineStage[]>(stages);
  const [newStageName, setNewStageName] = useState("");
  const [newStageColor, setNewStageColor] = useState(STAGE_COLORS[0]);
  const [saving, setSaving] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // Reglas de transicion del embudo (a que etapas se puede mover un negocio
  // desde la bandeja). `savedRules` es lo que hay en la base, para calcular
  // el diff al guardar; `ruleKeys` es lo marcado en el formulario, como
  // claves "origen:destino".
  const [savedRules, setSavedRules] = useState<PipelineStageTransition[]>([]);
  const [ruleKeys, setRuleKeys] = useState<Set<string>>(new Set());
  const [rulesLoading, setRulesLoading] = useState(false);

  // Reset form state when the dialog opens or its prop inputs change
  // — legitimate prop-driven sync.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!open) return;
    setName(pipeline.name);
    setLocalStages([...stages].sort((a, b) => a.position - b.position));
    setShowDeleteConfirm(false);
  }, [open, pipeline, stages]);

  // Carga las reglas del embudo cada vez que se abre el dialogo. `cancelled`
  // evita que una respuesta tardia de otro embudo pise el formulario.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setRulesLoading(true);
    createClient()
      .from("pipeline_stage_transitions")
      .select("*")
      .eq("pipeline_id", pipeline.id)
      .then(({ data, error }) => {
        if (cancelled) return;
        const rules = error ? [] : ((data as PipelineStageTransition[]) ?? []);
        setSavedRules(rules);
        setRuleKeys(new Set(rules.map(ruleKey)));
        setRulesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, pipeline.id]);
  /* eslint-enable react-hooks/set-state-in-effect */

  /**
   * Marca o desmarca en el formulario la regla `fromId → toId`. No escribe en
   * la base: eso lo hace `saveRules` al guardar.
   */
  function toggleRule(fromId: string, toId: string, checked: boolean) {
    setRuleKeys((prev) => {
      const next = new Set(prev);
      const key = `${fromId}:${toId}`;
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  /**
   * Reemplaza las reglas del embudo en la base por las marcadas: borra las
   * quitadas (por id) e inserta las nuevas. Solo cuenta reglas entre etapas
   * que siguen en el embudo; las de etapas borradas ya las quito la cascada.
   * Devuelve false si alguna de las dos escrituras falla.
   */
  async function saveRules(): Promise<boolean> {
    const stageIds = new Set(localStages.map((s) => s.id));
    const wanted = new Set(
      [...ruleKeys].filter((k) => {
        const [from, to] = k.split(":");
        return stageIds.has(from) && stageIds.has(to);
      }),
    );
    const current = savedRules.filter(
      (r) => stageIds.has(r.from_stage_id) && stageIds.has(r.to_stage_id),
    );
    const currentKeys = new Set(current.map(ruleKey));

    const toDelete = current.filter((r) => !wanted.has(ruleKey(r)));
    const toInsert = [...wanted]
      .filter((k) => !currentKeys.has(k))
      .map((k) => {
        const [from_stage_id, to_stage_id] = k.split(":");
        return { pipeline_id: pipeline.id, from_stage_id, to_stage_id };
      });

    let ok = true;
    if (toDelete.length > 0) {
      // `.select("id")`: sin permiso, la RLS filtra las filas y el delete no
      // da error pero tampoco borra nada; asi se detecta.
      const { data, error } = await supabase
        .from("pipeline_stage_transitions")
        .delete()
        .in(
          "id",
          toDelete.map((r) => r.id),
        )
        .select("id");
      if (error || (data?.length ?? 0) !== toDelete.length) ok = false;
    }
    if (toInsert.length > 0) {
      const { error } = await supabase
        .from("pipeline_stage_transitions")
        .insert(toInsert);
      if (error) ok = false;
    }
    return ok;
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  function handleReorder(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = localStages.findIndex((s) => s.id === active.id);
    const newIndex = localStages.findIndex((s) => s.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    setLocalStages(arrayMove(localStages, oldIndex, newIndex));
  }

  async function handleSave() {
    setSaving(true);

    // One upsert for all stages — batches N stage writes into a single
    // round-trip. Previous implementation did N sequential UPDATEs which
    // latency-scaled linearly with stage count.
    const stageRows = localStages.map((s, i) => ({
      id: s.id,
      pipeline_id: s.pipeline_id,
      name: s.name,
      color: s.color,
      position: i,
    }));

    const [renameRes, stagesRes] = await Promise.all([
      supabase
        .from("pipelines")
        .update({ name: name.trim() })
        .eq("id", pipeline.id),
      supabase.from("pipeline_stages").upsert(stageRows, { onConflict: "id" }),
    ]);

    if (renameRes.error || stagesRes.error) {
      setSaving(false);
      toast.error(t("toastFailedSave"));
      return;
    }

    // Las reglas van despues de las etapas: si estas fallan, no se toca nada.
    const rulesOk = await saveRules();
    setSaving(false);

    if (!rulesOk) {
      // El embudo y sus etapas si quedaron guardados; el dialogo sigue
      // abierto para poder reintentar las reglas. Se relee lo que quedo en
      // la base (pudo guardarse a medias) para que el reintento haga el diff
      // contra el estado real, sin tocar lo que el usuario tiene marcado.
      const { data } = await supabase
        .from("pipeline_stage_transitions")
        .select("*")
        .eq("pipeline_id", pipeline.id);
      if (data) setSavedRules(data as PipelineStageTransition[]);
      onPipelinesChanged();
      onStagesChanged();
      toast.error(t("toastFailedSaveTransitions"));
      return;
    }

    onOpenChange(false);
    onPipelinesChanged();
    onStagesChanged();
    toast.success(t("toastSaved"));
  }

  async function handleAddStage() {
    const trimmed = newStageName.trim();
    if (!trimmed) return;
    const { data, error } = await supabase
      .from("pipeline_stages")
      .insert({
        pipeline_id: pipeline.id,
        name: trimmed,
        color: newStageColor,
        position: localStages.length,
      })
      .select()
      .single();
    if (error || !data) {
      toast.error(t("toastFailedAddStage"));
      return;
    }
    setLocalStages([...localStages, data as PipelineStage]);
    setNewStageName("");
    setNewStageColor(STAGE_COLORS[(localStages.length + 1) % STAGE_COLORS.length]);
  }

  async function handleRemoveStage(stageId: string) {
    // Refuse to delete if deals still reference the stage (FK would fail).
    const { count } = await supabase
      .from("deals")
      .select("id", { count: "exact", head: true })
      .eq("stage_id", stageId);
    if (count && count > 0) {
      toast.error(t("toastMoveOrDeleteDeals"));
      return;
    }
    const { error } = await supabase
      .from("pipeline_stages")
      .delete()
      .eq("id", stageId);
    if (error) {
      toast.error(t("toastFailedDeleteStage"));
      return;
    }
    setLocalStages(localStages.filter((s) => s.id !== stageId));
  }

  async function handleDeletePipeline() {
    setDeleting(true);
    // ON DELETE CASCADE handles deals + stages.
    const { error } = await supabase
      .from("pipelines")
      .delete()
      .eq("id", pipeline.id);
    setDeleting(false);
    if (error) {
      toast.error(t("toastFailedDeletePipeline"));
      return;
    }
    onOpenChange(false);
    onPipelinesChanged();
    toast.success(t("toastDeleted"));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md bg-popover border-border max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">{t("managePipeline")}</DialogTitle>
        </DialogHeader>

        {showDeleteConfirm ? (
          <div className="py-4">
            <div className="flex items-center gap-3 rounded-lg border border-red-500/30 bg-red-500/10 p-4">
              <AlertTriangle className="h-5 w-5 shrink-0 text-red-400" />
              <div>
                <p className="text-sm font-medium text-red-400">
                  {t("deletePipeline")}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("deletePipelineDesc")}
                </p>
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setShowDeleteConfirm(false)}
                className="border-border bg-transparent text-muted-foreground hover:bg-muted"
              >
                {t("cancel")}
              </Button>
              <Button
                onClick={handleDeletePipeline}
                disabled={deleting}
                className="bg-red-600 text-white hover:bg-red-700"
              >
                {deleting ? t("deleting") : t("deletePipelineBtn")}
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="grid gap-4 py-2">
              <div className="grid gap-2">
                <Label className="text-muted-foreground">{t("pipelineName")}</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="border-border bg-muted text-foreground"
                />
              </div>

              <div className="grid gap-2">
                <Label className="text-muted-foreground">{t("stages")}</Label>
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={handleReorder}
                >
                  <SortableContext
                    items={localStages.map((s) => s.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    <div className="space-y-2">
                      {localStages.map((stage, index) => (
                        <SortableStageRow
                          key={stage.id}
                          stage={stage}
                          onNameChange={(v) => {
                            const updated = [...localStages];
                            updated[index] = { ...updated[index], name: v };
                            setLocalStages(updated);
                          }}
                          onColorChange={(v) => {
                            const updated = [...localStages];
                            updated[index] = { ...updated[index], color: v };
                            setLocalStages(updated);
                          }}
                          onRemove={() => handleRemoveStage(stage.id)}
                          colors={STAGE_COLORS}
                          t={t}
                        />
                      ))}
                    </div>
                  </SortableContext>
                </DndContext>

                {/* Add new stage */}
                <div className="mt-1 flex flex-wrap gap-1">
                  {STAGE_COLORS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      onClick={() => setNewStageColor(color)}
                      className="h-5 w-5 rounded-full border-2 transition-transform hover:scale-110"
                      style={{
                        backgroundColor: color,
                        borderColor:
                          newStageColor === color
                            ? "var(--foreground)"
                            : "transparent",
                      }}
                      aria-label={`Pick color ${color}`}
                    />
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    value={newStageName}
                    onChange={(e) => setNewStageName(e.target.value)}
                    placeholder={t("newStageNamePlaceholder")}
                    className="border-border bg-muted text-sm text-foreground"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleAddStage();
                    }}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleAddStage}
                    disabled={!newStageName.trim()}
                    className="shrink-0 border-border bg-transparent text-muted-foreground hover:bg-muted"
                  >
                    <Plus className="mr-1 h-3 w-3" />
                    {t("add")}
                  </Button>
                </div>
              </div>

              <TransitionsEditor
                stages={localStages}
                ruleKeys={ruleKeys}
                loading={rulesLoading}
                disabled={saving}
                onToggle={toggleRule}
                t={t}
              />

              <Button
                variant="outline"
                onClick={onCreateNewPipeline}
                className="w-full border-border bg-transparent text-muted-foreground hover:bg-muted"
              >
                <Plus className="mr-1 h-3 w-3" />
                {t("createNewPipeline")}
              </Button>
            </div>

            <DialogFooter className="border-border bg-popover/50">
              <Button
                onClick={() => setShowDeleteConfirm(true)}
                className="mr-auto bg-red-600 text-white hover:bg-red-700"
              >
                {t("deletePipeline")}
              </Button>
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                className="border-border bg-transparent text-muted-foreground hover:bg-muted"
              >
                {t("cancel")}
              </Button>
              <Button
                onClick={handleSave}
                disabled={saving || !name.trim()}
                className="bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {saving ? t("saving") : t("saveChanges")}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Clave "origen:destino" de una regla, para compararlas como conjunto. */
function ruleKey(r: Pick<PipelineStageTransition, "from_stage_id" | "to_stage_id">) {
  return `${r.from_stage_id}:${r.to_stage_id}`;
}

/**
 * Sección "Transiciones permitidas": una fila por etapa con una casilla por
 * cada otra etapa del embudo. Solo pinta y avisa; guardar lo hace el
 * formulario con el resto del embudo.
 */
function TransitionsEditor({
  stages,
  ruleKeys,
  loading,
  disabled,
  onToggle,
  t,
}: {
  stages: PipelineStage[];
  ruleKeys: Set<string>;
  loading: boolean;
  disabled: boolean;
  onToggle: (fromId: string, toId: string, checked: boolean) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  t: any;
}) {
  // Solo cuentan las reglas entre etapas que siguen en el embudo.
  const hasAnyRule = stages.some((from) =>
    stages.some((to) => ruleKeys.has(`${from.id}:${to.id}`)),
  );

  return (
    <div className="grid gap-2">
      <Label className="text-muted-foreground">{t("transitions")}</Label>
      <p className="text-xs leading-relaxed text-muted-foreground">
        {t("transitionsHint")}
      </p>

      {loading ? (
        <p className="text-xs text-muted-foreground">{t("transitionsLoading")}</p>
      ) : stages.length < 2 ? (
        <p className="text-xs text-muted-foreground">
          {t("transitionsNeedTwoStages")}
        </p>
      ) : (
        <>
          {!hasAnyRule && (
            <p className="rounded-md bg-muted px-2 py-1.5 text-xs text-muted-foreground">
              {t("transitionsNone")}
            </p>
          )}
          <div className="space-y-2">
            {stages.map((from) => {
              const targets = stages.filter((s) => s.id !== from.id);
              const isFinal =
                hasAnyRule &&
                !targets.some((to) => ruleKeys.has(`${from.id}:${to.id}`));
              const headingId = `transition-from-${from.id}`;
              return (
                <div
                  key={from.id}
                  role="group"
                  aria-labelledby={headingId}
                  className="rounded-lg border border-border bg-muted/50 p-2"
                >
                  <div
                    id={headingId}
                    className="flex items-center gap-2 text-sm font-medium text-foreground"
                  >
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: from.color }}
                      aria-hidden="true"
                    />
                    <span className="truncate">
                      {t("transitionsFrom", { stage: from.name || "—" })}
                    </span>
                    {isFinal && (
                      <span className="ml-auto shrink-0 rounded-full border border-border px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">
                        {t("finalStage")}
                      </span>
                    )}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-2 pl-4">
                    {targets.map((to) => (
                      <label
                        key={to.id}
                        className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground has-[[data-disabled]]:cursor-not-allowed"
                      >
                        <Checkbox
                          checked={ruleKeys.has(`${from.id}:${to.id}`)}
                          onCheckedChange={(checked) =>
                            onToggle(from.id, to.id, checked === true)
                          }
                          disabled={disabled}
                        />
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ backgroundColor: to.color }}
                          aria-hidden="true"
                        />
                        {to.name || "—"}
                      </label>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function SortableStageRow({
  stage,
  onNameChange,
  onColorChange,
  onRemove,
  colors,
  t,
}: {
  stage: PipelineStage;
  onNameChange: (v: string) => void;
  onColorChange: (v: string) => void;
  onRemove: () => void;
  colors: string[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  t: any;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: stage.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2 rounded-lg border border-border bg-muted p-2"
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="cursor-grab touch-none text-muted-foreground hover:text-foreground active:cursor-grabbing"
        aria-label={t("dragToReorder")}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <ColorSwatch value={stage.color} onChange={onColorChange} colors={colors} t={t} />
      <Input
        value={stage.name}
        onChange={(e) => onNameChange(e.target.value)}
        className="h-7 flex-1 border-transparent bg-transparent text-sm text-foreground focus:border-border"
      />
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={onRemove}
        className="text-muted-foreground hover:text-red-400"
      >
        <Trash2 className="h-3 w-3" />
      </Button>
    </div>
  );
}

function ColorSwatch({
  value,
  onChange,
  colors,
  t,
}: {
  value: string;
  onChange: (v: string) => void;
  colors: string[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  t: any;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="h-4 w-4 rounded-full border border-border"
        style={{ backgroundColor: value }}
        aria-label={t("changeColor")}
      />
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-6 z-20 flex flex-wrap gap-1 rounded-lg border border-border bg-popover p-2 shadow-lg w-36">
            {colors.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => {
                  onChange(c);
                  setOpen(false);
                }}
                className="h-5 w-5 rounded-full border-2 transition-transform hover:scale-110"
                style={{
                  backgroundColor: c,
                  borderColor:
                    c === value ? "var(--foreground)" : "transparent",
                }}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
