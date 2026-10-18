'use client';

import { useEffect, useState } from 'react';
import { format, subDays } from 'date-fns';
import { Download, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface ManagementReportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface AgentOption {
  user_id: string;
  full_name: string;
}

const dayKey = (d: Date) => format(d, 'yyyy-MM-dd');

/**
 * Descarga del informe de gestión de asesores en Excel (cambio
 * informe-gestion-asesores). Solo lo abre admin u owner; la ruta lo
 * vuelve a exigir.
 */
export function ManagementReportDialog({
  open,
  onOpenChange,
}: ManagementReportDialogProps) {
  const t = useTranslations('Contacts.managementReport');
  const [from, setFrom] = useState(() => dayKey(subDays(new Date(), 29)));
  const [to, setTo] = useState(() => dayKey(new Date()));
  const [agent, setAgent] = useState<string>('all');
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [downloading, setDownloading] = useState(false);

  // Los que atienden clientes: admin y agent. El owner no sale en ninguna
  // lista de asesores (`isAssignableRole`).
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await createClient()
        .from('profiles')
        .select('user_id, full_name')
        .in('account_role', ['admin', 'agent'])
        .order('full_name');
      if (cancelled) return;
      if (error) {
        console.error('Failed to fetch agents:', error.message);
        return;
      }
      setAgents((data as AgentOption[]) ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const agentLabel = (v: string) =>
    v === 'all'
      ? t('agentAll')
      : v === 'unassigned'
        ? t('agentUnassigned')
        : (agents.find((a) => a.user_id === v)?.full_name ?? '');

  const invalidRange = Boolean(from && to && from > to);

  async function handleDownload() {
    setDownloading(true);
    try {
      const params = new URLSearchParams();
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      if (agent !== 'all') params.set('agent', agent);

      const res = await fetch(`/api/reports/management?${params}`);
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        toast.error(body?.error ?? t('downloadFailed'));
        return;
      }

      const blob = await res.blob();
      const disposition = res.headers.get('Content-Disposition') ?? '';
      const filename =
        /filename="([^"]+)"/.exec(disposition)?.[1] ??
        `informe-gestion-${dayKey(new Date())}.xlsx`;

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      onOpenChange(false);
    } catch (err) {
      console.error('Management report download failed:', err);
      toast.error(t('downloadFailed'));
    } finally {
      setDownloading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="report-from">{t('from')}</Label>
              <Input
                id="report-from"
                type="date"
                value={from}
                max={to || undefined}
                onChange={(e) => setFrom(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="report-to">{t('to')}</Label>
              <Input
                id="report-to"
                type="date"
                value={to}
                min={from || undefined}
                onChange={(e) => setTo(e.target.value)}
              />
            </div>
          </div>
          <p className="text-muted-foreground -mt-2 text-xs">{t('rangeHint')}</p>

          <div className="grid gap-1.5">
            <Label>{t('agent')}</Label>
            <Select value={agent} onValueChange={(v) => setAgent(String(v))}>
              <SelectTrigger className="w-full">
                <SelectValue>{(v: string) => agentLabel(v)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('agentAll')}</SelectItem>
                <SelectItem value="unassigned">{t('agentUnassigned')}</SelectItem>
                {agents.map((a) => (
                  <SelectItem key={a.user_id} value={a.user_id}>
                    {a.full_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {invalidRange && (
            <p className="text-destructive text-xs">{t('invalidRange')}</p>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={downloading}
          >
            {t('cancel')}
          </Button>
          <Button onClick={handleDownload} disabled={downloading || invalidRange}>
            {downloading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Download className="size-4" />
            )}
            {downloading ? t('generating') : t('download')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
