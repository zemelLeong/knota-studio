import type { ReactNode } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import { useT } from '@/i18n';
import { toast } from '@/utils/toast';
import type { WorkerDefinitionResponse } from './options';
import {
  batchSetWorkerGrants,
  getAllTenants,
  getWorkerGrantTenants,
} from './options';

interface TenantOption {
  id: string;
  name: string;
  code: string;
}

interface GrantTenantsDialogProps {
  open: boolean;
  workerDef: WorkerDefinitionResponse | null;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

const GrantTenantsDialog = ({
  open,
  workerDef,
  onOpenChange,
  onSuccess,
}: GrantTenantsDialogProps) => {
  const t = useT();
  const [tenantOptions, setTenantOptions] = useState<TenantOption[]>([]);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !workerDef) return;
    let cancelled = false;
    setLoading(true);

    void Promise.all([getAllTenants(), getWorkerGrantTenants(workerDef.code)])
      .then(([tenantRes, grantedRes]) => {
        if (cancelled) return;
        setTenantOptions(
          tenantRes.items.map((tenant) => ({
            id: tenant.id,
            name: tenant.name,
            code: tenant.code,
          })),
        );
        setCheckedIds(new Set(grantedRes.map((g) => g.id)));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, workerDef]);

  useEffect(() => {
    if (!open) {
      setCheckedIds(new Set());
      setTenantOptions([]);
    }
  }, [open]);

  const toggleTenant = useCallback((id: string) => {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    setCheckedIds((prev) => {
      const allChecked = tenantOptions.every((t) => prev.has(t.id));
      const next = new Set(prev);
      for (const tenant of tenantOptions) {
        if (allChecked) {
          next.delete(tenant.id);
        } else {
          next.add(tenant.id);
        }
      }
      return next;
    });
  }, [tenantOptions]);

  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!workerDef) return;
    setSubmitting(true);
    try {
      await batchSetWorkerGrants(workerDef.code, [...checkedIds]);
      toast.success(t('SchedulerMgmt.toast.grantsSaved', '授权保存成功'));
      onSuccess();
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  };

  const allChecked =
    tenantOptions.length > 0 &&
    tenantOptions.every((t) => checkedIds.has(t.id));
  const someChecked =
    !allChecked && tenantOptions.some((t) => checkedIds.has(t.id));
  let allCheckedState: boolean | 'indeterminate' = false;
  if (allChecked) {
    allCheckedState = true;
  } else if (someChecked) {
    allCheckedState = 'indeterminate';
  }

  let content: ReactNode;
  if (loading) {
    content = (
      <p className="text-sm text-muted-foreground">
        {t('SchedulerMgmt.loading', '加载中...')}
      </p>
    );
  } else if (tenantOptions.length === 0) {
    content = (
      <p className="text-sm text-muted-foreground">
        {t('SchedulerMgmt.noTenants', '暂无可授权的租户')}
      </p>
    );
  } else {
    content = (
      <>
        <div className="flex items-center gap-2 pb-2">
          <Checkbox checked={allCheckedState} onCheckedChange={toggleAll} />
          <span className="text-sm font-medium">
            {t('SchedulerMgmt.selectAll', '全选')}
          </span>
          <span className="text-xs text-muted-foreground">
            ({checkedIds.size}/{tenantOptions.length})
          </span>
        </div>
        <Separator />
        <div className="space-y-1 pt-1">
          {tenantOptions.map((tenant) => (
            // biome-ignore lint/a11y/noLabelWithoutControl: checkbox is inside label
            <label
              key={tenant.id}
              className="flex items-center gap-2 cursor-pointer rounded-md px-2 py-1.5 hover:bg-accent"
            >
              <Checkbox
                checked={checkedIds.has(tenant.id)}
                onCheckedChange={() => toggleTenant(tenant.id)}
              />
              <span className="text-sm">{tenant.name}</span>
              <span className="text-xs text-muted-foreground">
                ({tenant.code})
              </span>
            </label>
          ))}
        </div>
      </>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] max-h-[80vh]">
        <DialogHeader>
          <DialogTitle>
            {t('SchedulerMgmt.dialog.grantTenants', '授权租户')}
          </DialogTitle>
          <DialogDescription>
            {t(
              'SchedulerMgmt.dialog.grantTenantsDesc',
              '为任务「{{name}}」授权可执行的租户',
              { name: workerDef?.name ?? '' },
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="py-4 overflow-y-auto max-h-[55vh] space-y-2">
          {content}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('SchedulerMgmt.dialog.cancel', '取消')}
          </Button>
          <Button onClick={handleSubmit} disabled={submitting || loading}>
            {submitting
              ? t('SchedulerMgmt.dialog.submitting', '提交中...')
              : t('SchedulerMgmt.dialog.confirm', '确认')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export type { GrantTenantsDialogProps };
export { GrantTenantsDialog };
