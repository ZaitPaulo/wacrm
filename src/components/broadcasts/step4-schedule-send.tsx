'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { MessageTemplate } from '@/types';
import {
  checkFollowUpTemplate,
  type FollowUpTemplateProblem,
} from '@/lib/whatsapp/follow-up-template';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { ArrowLeft, Send, Loader2, Users, Save, BellRing, EyeOff } from 'lucide-react';
import { useTranslations } from 'next-intl';

interface AudienceConfig {
  type: string;
  tagIds?: string[];
  csvContacts?: { phone: string; name?: string }[];
}

/**
 * El recordatorio a quien no responda (migración 524). Se configura acá y
 * se guarda con la difusión; lo manda el cron del servidor al vencer el
 * plazo, sin depender de esta pestaña.
 */
export interface FollowUpConfig {
  enabled: boolean;
  template: MessageTemplate | null;
  /** 1 a 7. Se guarda en horas (`delayDays * 24`). */
  delayDays: number;
}

const DELAY_OPTIONS = [1, 2, 3, 4, 5, 6, 7] as const;

/**
 * Baja por silencio (migración 525): pasado el plazo desde este envío, se
 * ocultan de la vitrina los vehículos de quien no respondió. La corre el
 * cron del servidor.
 */
export interface NoReplyConfig {
  enabled: boolean;
  /** Días desde el envío original. */
  days: number;
}

const NO_REPLY_OPTIONS = [30, 45, 60, 90] as const;

interface Step4Props {
  name: string;
  onNameChange: (name: string) => void;
  template: MessageTemplate;
  audience: AudienceConfig;
  followUp: FollowUpConfig;
  onFollowUpChange: (followUp: FollowUpConfig) => void;
  noReply: NoReplyConfig;
  onNoReplyChange: (noReply: NoReplyConfig) => void;
  onSend: () => void;
  onSaveDraft?: () => void;
  onBack: () => void;
  isProcessing: boolean;
  progress: number;
}

export function Step4ScheduleSend({
  name,
  onNameChange,
  template,
  audience,
  followUp,
  onFollowUpChange,
  noReply,
  onNoReplyChange,
  onSend,
  onSaveDraft,
  onBack,
  isProcessing,
  progress,
}: Step4Props) {
  const t = useTranslations('Broadcasts.wizard');
  const [showConfirm, setShowConfirm] = useState(false);
  const [estimatedReach, setEstimatedReach] = useState<number>(0);
  const [loadingReach, setLoadingReach] = useState(true);
  const [followUpTemplates, setFollowUpTemplates] = useState<MessageTemplate[] | null>(null);

  useEffect(() => {
    async function calculateReach() {
      setLoadingReach(true);
      try {
        const supabase = createClient();

        if (audience.type === 'all') {
          const { count } = await supabase
            .from('contacts')
            .select('*', { count: 'exact', head: true });
          setEstimatedReach(count ?? 0);
        } else if (audience.type === 'tags' && audience.tagIds && audience.tagIds.length > 0) {
          const { data: contactTags } = await supabase
            .from('contact_tags')
            .select('contact_id')
            .in('tag_id', audience.tagIds);

          const uniqueIds = new Set((contactTags ?? []).map((ct) => ct.contact_id));
          setEstimatedReach(uniqueIds.size);
        } else if (audience.type === 'csv' && audience.csvContacts) {
          setEstimatedReach(audience.csvContacts.length);
        } else {
          setEstimatedReach(0);
        }
      } finally {
        setLoadingReach(false);
      }
    }

    calculateReach();
  }, [audience]);

  // Las plantillas del recordatorio se cargan la primera vez que se
  // activa el seguimiento. Solo aprobadas: igual que en el paso 1, una
  // que no lo esté fallaría al enviarse.
  useEffect(() => {
    if (!followUp.enabled || followUpTemplates !== null) return;
    async function loadTemplates() {
      const supabase = createClient();
      const { data } = await supabase
        .from('message_templates')
        .select('*')
        .eq('status', 'APPROVED')
        .order('created_at', { ascending: false });
      setFollowUpTemplates((data ?? []) as MessageTemplate[]);
    }
    loadTemplates();
  }, [followUp.enabled, followUpTemplates]);

  const followUpProblem: FollowUpTemplateProblem | 'missing' | null = (() => {
    if (!followUp.enabled) return null;
    if (!followUp.template) return 'missing';
    const check = checkFollowUpTemplate(template, followUp.template);
    return check.ok ? null : check.problem;
  })();

  function problemMessage(problem: FollowUpTemplateProblem | 'missing'): string {
    switch (problem) {
      case 'missing':
        return t('scheduleSend.followUp.problems.missing');
      case 'variable_mismatch':
        return t('scheduleSend.followUp.problems.variable_mismatch');
      case 'media_header':
        return t('scheduleSend.followUp.problems.media_header');
      case 'header_variable':
        return t('scheduleSend.followUp.problems.header_variable');
      case 'button_needs_value':
        return t('scheduleSend.followUp.problems.button_needs_value');
    }
  }

  const templateItems = (followUpTemplates ?? []).map((tpl) => ({
    value: tpl.id,
    label: `${tpl.name} (${tpl.language ?? 'en_US'})`,
  }));
  const delayItems = DELAY_OPTIONS.map((d) => ({
    value: String(d),
    label: t('scheduleSend.followUp.delayDays', { count: d }),
  }));
  const noReplyItems = NO_REPLY_OPTIONS.map((d) => ({
    value: String(d),
    label: t('scheduleSend.noReply.delayDays', { count: d }),
  }));

  const audienceLabel =
    audience.type === 'all'
      ? t('scheduleSend.audienceAll')
      : audience.type === 'tags'
        ? t('scheduleSend.audienceTags')
        : audience.type === 'csv'
          ? t('scheduleSend.audienceCsv')
          : t('scheduleSend.audienceField');

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">{t('scheduleSend.title')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('scheduleSend.subtitle')}
        </p>
      </div>

      {/* Broadcast Name */}
      <div>
        <label className="mb-1.5 block text-sm font-medium text-foreground">{t('scheduleSend.broadcastName')}</label>
        <Input
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder={t('scheduleSend.broadcastNamePlaceholder')}
          className="border-border bg-muted text-foreground placeholder:text-muted-foreground"
        />
      </div>

      {/* Seguimiento (migración 524) */}
      <div className="space-y-4 rounded-xl border border-border bg-card/50 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="flex items-center gap-2 text-sm font-medium text-foreground">
              <BellRing className="h-4 w-4 text-primary" />
              {t('scheduleSend.followUp.title')}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t('scheduleSend.followUp.description')}
            </p>
          </div>
          <Switch
            checked={followUp.enabled}
            onCheckedChange={(checked) =>
              onFollowUpChange({ ...followUp, enabled: checked })
            }
            aria-label={t('scheduleSend.followUp.enable')}
            disabled={isProcessing}
          />
        </div>

        {followUp.enabled && (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-foreground">
                  {t('scheduleSend.followUp.template')}
                </label>
                {followUpTemplates === null ? (
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                ) : followUpTemplates.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    {t('scheduleSend.followUp.noTemplates')}
                  </p>
                ) : (
                  <Select
                    items={templateItems}
                    value={followUp.template?.id ?? null}
                    onValueChange={(id) =>
                      onFollowUpChange({
                        ...followUp,
                        template: followUpTemplates.find((tpl) => tpl.id === id) ?? null,
                      })
                    }
                  >
                    <SelectTrigger className="w-full border-border bg-muted text-foreground">
                      <SelectValue placeholder={t('scheduleSend.followUp.templatePlaceholder')} />
                    </SelectTrigger>
                    <SelectContent className="border-border bg-popover">
                      {templateItems.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-foreground">
                  {t('scheduleSend.followUp.delay')}
                </label>
                <Select
                  items={delayItems}
                  value={String(followUp.delayDays)}
                  onValueChange={(v) =>
                    onFollowUpChange({ ...followUp, delayDays: Number(v) })
                  }
                >
                  <SelectTrigger className="w-32 border-border bg-muted text-foreground">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="border-border bg-popover">
                    {delayItems.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {followUpProblem && (
              <p className="text-xs text-red-400">{problemMessage(followUpProblem)}</p>
            )}
            <p className="text-xs text-muted-foreground">
              {t('scheduleSend.followUp.quietHoursHint')}
            </p>
          </div>
        )}

        {/* Baja por silencio (migración 525). Independiente del
            recordatorio: una difusión puede tener uno, otro o los dos. */}
        <div className="space-y-3 border-t border-border pt-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                <EyeOff className="h-4 w-4 text-primary" />
                {t('scheduleSend.noReply.title')}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t('scheduleSend.noReply.description')}
              </p>
            </div>
            <Switch
              checked={noReply.enabled}
              onCheckedChange={(checked) => onNoReplyChange({ ...noReply, enabled: checked })}
              aria-label={t('scheduleSend.noReply.title')}
              disabled={isProcessing}
            />
          </div>

          {noReply.enabled && (
            <div className="space-y-2">
              <label className="block text-xs font-medium text-foreground">
                {t('scheduleSend.noReply.delay')}
              </label>
              <Select
                items={noReplyItems}
                value={String(noReply.days)}
                onValueChange={(v) => onNoReplyChange({ ...noReply, days: Number(v) })}
              >
                <SelectTrigger className="w-32 border-border bg-muted text-foreground">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="border-border bg-popover">
                  {noReplyItems.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {t('scheduleSend.noReply.ownersOnly')}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Summary Card */}
      <div className="rounded-xl border border-border bg-card/50 p-4 space-y-3">
        <p className="text-sm font-medium text-foreground">{t('scheduleSend.summary')}</p>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-xs text-muted-foreground">{t('scheduleSend.template')}</p>
            <p className="text-foreground">{template.name}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t('scheduleSend.audience')}</p>
            <p className="text-foreground">{audienceLabel}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Estimated Reach</p>
            <div className="flex items-center gap-1.5">
              {loadingReach ? (
                <Loader2 className="h-3 w-3 animate-spin text-primary" />
              ) : (
                <>
                  <Users className="h-3.5 w-3.5 text-primary" />
                  <p className="font-medium text-foreground">{estimatedReach.toLocaleString()}</p>
                </>
              )}
            </div>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Language</p>
            <p className="text-foreground">{template.language ?? 'en_US'}</p>
          </div>
          <div className="col-span-2">
            <p className="text-xs text-muted-foreground">{t('scheduleSend.followUp.summary')}</p>
            <p className="text-foreground">
              {followUp.enabled && followUp.template
                ? t('scheduleSend.followUp.summaryValue', {
                    template: followUp.template.name,
                    days: followUp.delayDays,
                  })
                : t('scheduleSend.followUp.summaryOff')}
            </p>
          </div>
          <div className="col-span-2">
            <p className="text-xs text-muted-foreground">{t('scheduleSend.noReply.summary')}</p>
            <p className="text-foreground">
              {noReply.enabled
                ? t('scheduleSend.noReply.summaryValue', { days: noReply.days })
                : t('scheduleSend.noReply.summaryOff')}
            </p>
          </div>
        </div>
      </div>

      {/* Processing overlay */}
      {isProcessing && (
        <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              <p className="text-sm font-medium text-foreground">{t('scheduleSend.sending')}</p>
            </div>
            <span className="text-xs font-medium text-primary">{progress}%</span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-muted">
            <div
              className="h-1.5 rounded-full bg-primary transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
        <Button
          variant="outline"
          onClick={onBack}
          disabled={isProcessing}
          className="border-border text-muted-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          {t('back')}
        </Button>

        <div className="flex items-center gap-2">
          {onSaveDraft && (
            <Button
              variant="outline"
              onClick={onSaveDraft}
              disabled={!name.trim() || isProcessing}
              className="border-border text-muted-foreground hover:bg-muted disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              {t('scheduleSend.saveDraft')}
            </Button>
          )}

          <Dialog open={showConfirm} onOpenChange={setShowConfirm}>
          <DialogTrigger
            render={
              <Button
                disabled={!name.trim() || isProcessing || followUpProblem !== null}
                className="bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              />
            }
          >
            <Send className="h-4 w-4" />
            {t('scheduleSend.sendNow')}
          </DialogTrigger>
          <DialogContent className="border-border bg-popover sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="text-popover-foreground">Confirm Broadcast</DialogTitle>
              <DialogDescription className="text-muted-foreground">
                You are about to send this broadcast to{' '}
                <span className="font-medium text-popover-foreground">{estimatedReach.toLocaleString()}</span>{' '}
                contacts using the{' '}
                <span className="font-medium text-popover-foreground">{template.name}</span> template.
                This action cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setShowConfirm(false)}
                className="border-border text-muted-foreground"
              >
                {t('cancel')}
              </Button>
              <Button
                onClick={() => {
                  setShowConfirm(false);
                  onSend();
                }}
                className="bg-primary text-primary-foreground hover:bg-primary/90"
              >
                <Send className="h-4 w-4" />
                {t('scheduleSend.sendNow')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        </div>
      </div>
    </div>
  );
}
