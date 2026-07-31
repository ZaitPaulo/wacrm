"use client";

/**
 * Reusable field components shared across every per-node form.
 *
 * `NodeKeySelect` — picks a node from the flow's node list, rendered
 * with the source node's icon so the dropdown reads as
 * "destination = ◇ menu" rather than an opaque slug.
 *
 * `NextNodeRow` — wraps NodeKeySelect with a label; the most common
 * per-node form row ("after this node, advance to…").
 *
 * `TextRow` — wraps Input or Textarea behind a label. Pure UI sugar
 * to keep per-node forms uncluttered.
 *
 * `AgentSelectRow` — picks an account member, storing their user_id.
 * Shared by the handoff node's own agent and the flow-level default,
 * which are the same choice asked at two scopes.
 *
 * Lives in src/components/flows/forms/ so both the list view's
 * collapsed-card editor and the canvas view's side-panel editor
 * (introduced in this PR) mount the exact same form components.
 */

import { useEffect, useState } from "react";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";
import type { AccountMember } from "@/types";
import { NODE_META, type BuilderNode } from "../shared";

export function TextRow({
  label,
  value,
  onChange,
  rows = 1,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs text-muted-foreground">{label}</label>
      {rows > 1 ? (
        <Textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={rows}
          className="bg-muted"
        />
      ) : (
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="bg-muted"
        />
      )}
    </div>
  );
}

export function NextNodeRow({
  value,
  allNodes,
  currentKey,
  onChange,
  label,
}: {
  value: string;
  allNodes: BuilderNode[];
  currentKey: string;
  onChange: (v: string) => void;
  label: string;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs text-muted-foreground">{label}</label>
      <NodeKeySelect
        value={value || null}
        nodes={allNodes}
        excludeKey={currentKey}
        onChange={(v) => onChange(v ?? "")}
        placeholder={useTranslations("Flows.builder.form")("pickNextNode")}
      />
    </div>
  );
}

/**
 * Account roster for the agent pickers.
 *
 * Goes through the API rather than querying `profiles` directly so it
 * inherits the endpoint's email-visibility rules (agents and viewers
 * don't see teammates' emails). Any failure — older deployment, offline
 * — resolves to an empty list, which `AgentSelectRow` renders as a raw
 * id input so a flow stays authorable either way.
 */
function useAccountMembers(): AccountMember[] {
  const [members, setMembers] = useState<AccountMember[]>([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/account/members", { cache: "no-store" });
        if (!res.ok) return;
        const json = (await res.json()) as { members?: AccountMember[] };
        if (!cancelled) setMembers(json.members ?? []);
      } catch {
        // Members endpoint unreachable — caller falls back to raw input.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return members;
}

/**
 * Agent picker storing the member's `user_id`. Empty string means "no
 * agent" — the callers persist it straight into JSONB, and both the
 * node config and the fallback policy read a blank value as unset.
 *
 * Mirrors the automations builder's AgentSelect on the three cases that
 * matter: no roster → raw id input; an explicit "unassigned" option;
 * and a saved id that is no longer a member kept as a labelled option,
 * so editing a flow can't silently drop the routing someone configured.
 */
export function AgentSelectRow({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
}) {
  const t = useTranslations("Flows.builder.form");
  const members = useAccountMembers();
  const selected = members.find((m) => m.user_id === value);

  return (
    <div>
      <label className="mb-1 block text-xs text-muted-foreground">{label}</label>
      {members.length === 0 ? (
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={t("agentIdPlaceholder")}
          className="bg-muted"
        />
      ) : (
        <Select
          value={value || "__none__"}
          // The sentinel and a null value both mean "no agent" — the
          // Select can't carry "" as an item value.
          onValueChange={(v) => onChange(!v || v === "__none__" ? "" : v)}
        >
          <SelectTrigger className="bg-muted">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">{t("agentUnassigned")}</SelectItem>
            {members.map((m) => (
              <SelectItem key={m.user_id} value={m.user_id}>
                {m.full_name || m.email || m.user_id}
              </SelectItem>
            ))}
            {value && !selected && (
              <SelectItem value={value}>
                {t("agentUnknown", { id: value })}
              </SelectItem>
            )}
          </SelectContent>
        </Select>
      )}
      {hint && (
        <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}

export function NodeKeySelect({
  value,
  nodes,
  excludeKey,
  onChange,
  placeholder,
  className,
}: {
  value: string | null;
  nodes: BuilderNode[];
  excludeKey?: string;
  onChange: (v: string | null) => void;
  placeholder?: string;
  className?: string;
}) {
  const t = useTranslations("Flows.builder.form");
  const options = nodes.filter((n) => n.node_key !== excludeKey);
  return (
    <Select
      value={value ?? "__none__"}
      onValueChange={(v) => onChange(v === "__none__" ? null : v)}
    >
      <SelectTrigger className={cn("bg-muted", className)}>
        <SelectValue placeholder={placeholder ?? "—"} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__none__">{t("none")}</SelectItem>
        {options.map((n) => {
          const Icon = NODE_META[n.node_type].icon;
          return (
            <SelectItem key={n.node_key} value={n.node_key}>
              <span className="inline-flex items-center gap-1.5">
                <Icon
                  className={cn("h-3 w-3", NODE_META[n.node_type].color)}
                />
                {n.node_key}
              </span>
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}
