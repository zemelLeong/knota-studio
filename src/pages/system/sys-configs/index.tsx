import { useRequest } from 'ahooks';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ProTableColumnDef, ProTableRef } from '@/components/pro-table';
import { buildColumns, ProTable } from '@/components/pro-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { useT } from '@/i18n';
import type { SysConfigResponse } from '@/types/sys-config';
import { toast } from '@/utils/toast';
import { useSysConfigsAgent } from './agent';
import {
  createSysConfigTableColumns,
  deleteGlobalConfig,
  deleteTenantOverride,
  listGlobalConfigs,
  listTenantOverrides,
  upsertTenantOverride,
} from './options';
import { SysConfigDialog } from './SysConfigDialog';

const TenantOverrideSheet = ({
  config,
  open,
  onOpenChange,
  onRefresh,
}: {
  config: SysConfigResponse | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRefresh: () => void;
}) => {
  const t = useT();

  const {
    data: overrides,
    run: fetchOverrides,
    loading,
  } = useRequest(
    () =>
      config
        ? listTenantOverrides({ prefix: config.key })
        : Promise.resolve([]),
    { manual: true },
  );

  useEffect(() => {
    if (config && open) fetchOverrides();
  }, [config, config?.key, open, fetchOverrides]);

  const existing = overrides?.find((o) => o.key === config?.key);
  const hasOverride = !!existing;

  const [overrideValue, setOverrideValue] = useState('');

  useEffect(() => {
    if (existing) {
      setOverrideValue(existing.value);
    } else {
      setOverrideValue('');
    }
  }, [existing]);

  const handleSave = useCallback(() => {
    if (!config) return;
    void upsertTenantOverride(config.key, { value: overrideValue }).then(() => {
      toast.success(t('SysConfigMgmt.override.toastSaved', '覆盖已保存'));
      fetchOverrides();
      onRefresh();
    });
  }, [config, overrideValue, fetchOverrides, onRefresh, t]);

  const handleDelete = useCallback(() => {
    if (!config) return;
    void deleteTenantOverride(config.key).then(() => {
      toast.success(t('SysConfigMgmt.override.toastDeleted', '覆盖已删除'));
      setOverrideValue('');
      fetchOverrides();
      onRefresh();
    });
  }, [config, fetchOverrides, onRefresh, t]);

  if (!config) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>
            {t('SysConfigMgmt.override.title', '租户覆盖配置')}
          </SheetTitle>
          <SheetDescription className="font-mono text-xs">
            {config.key}
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-4 px-4">
          <div className="flex flex-col gap-1">
            <Label className="text-muted-foreground text-xs">
              {t('SysConfigMgmt.override.displayLabel', '显示名')}
            </Label>
            <span className="text-sm">{config.label}</span>
          </div>

          <div className="flex flex-col gap-1">
            <Label className="text-muted-foreground text-xs">
              {t('SysConfigMgmt.override.globalValue', '全局值')}
            </Label>
            <span className="rounded bg-muted px-2 py-1 font-mono text-sm">
              {config.value}
            </span>
          </div>

          <Separator />

          <div className="flex flex-col gap-2">
            <Label className="text-sm">
              {t('SysConfigMgmt.override.overrideValue', '覆盖值')}
            </Label>
            {loading ? (
              <div className="text-muted-foreground text-sm">...</div>
            ) : (
              <textarea
                className="min-h-[100px] w-full rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs focus:outline-none focus:ring-1 focus:ring-ring"
                placeholder={t(
                  'SysConfigMgmt.override.placeholder',
                  '输入覆盖值',
                )}
                value={overrideValue}
                onChange={(e) => setOverrideValue(e.target.value)}
              />
            )}
            {!hasOverride && !loading && (
              <span className="text-muted-foreground text-xs">
                {t('SysConfigMgmt.override.noOverride', '当前无覆盖')}
              </span>
            )}
          </div>
        </div>

        <div className="mt-auto flex items-center gap-2 px-4 pb-4">
          <Button size="sm" onClick={handleSave} disabled={!overrideValue}>
            {hasOverride
              ? t('SysConfigMgmt.override.update', '更新覆盖')
              : t('SysConfigMgmt.override.create', '创建覆盖')}
          </Button>
          {hasOverride && (
            <Button variant="destructive" size="sm" onClick={handleDelete}>
              {t('SysConfigMgmt.override.delete', '删除覆盖')}
            </Button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
};

const SysConfigsPage = () => {
  const t = useT();
  useSysConfigsAgent();

  const valueTypeMap = useMemo<
    Record<
      string,
      {
        label: string;
        variant: 'default' | 'secondary' | 'outline' | 'destructive';
      }
    >
  >(
    () => ({
      string: {
        label: t('SysConfigMgmt.valueTypeString', '字符串'),
        variant: 'default',
      },
      number: {
        label: t('SysConfigMgmt.valueTypeNumber', '数字'),
        variant: 'secondary',
      },
      boolean: {
        label: t('SysConfigMgmt.valueTypeBoolean', '布尔'),
        variant: 'outline',
      },
      json: {
        label: t('SysConfigMgmt.valueTypeJson', 'JSON'),
        variant: 'destructive',
      },
    }),
    [t],
  );

  const scopeVariantMap = useMemo<
    Record<string, { label: string; variant: 'default' | 'secondary' }>
  >(
    () => ({
      global: {
        label: t('SysConfigMgmt.scopeGlobal', '全局'),
        variant: 'default',
      },
      tenant: {
        label: t('SysConfigMgmt.scopeTenant', '租户'),
        variant: 'secondary',
      },
    }),
    [t],
  );

  const [createOpen, setCreateOpen] = useState(false);
  const [editConfig, setEditConfig] = useState<SysConfigResponse | null>(null);
  const [overrideConfig, setOverrideConfig] =
    useState<SysConfigResponse | null>(null);
  const tableRef = useRef<ProTableRef>(null);

  const handleSuccess = useCallback(() => {
    tableRef.current?.refresh();
  }, []);

  const handleDelete = useCallback(
    (config: SysConfigResponse) => {
      void deleteGlobalConfig(config.key).then(() => {
        toast.success(t('SysConfigMgmt.toast.deleted', '配置删除成功'));
        handleSuccess();
      });
    },
    [handleSuccess, t],
  );

  const columns = useMemo(
    () =>
      buildColumns<SysConfigResponse>(createSysConfigTableColumns(t), {
        key: ({ row }) => (
          <button
            type="button"
            className="text-left font-mono text-sm font-medium text-primary hover:underline cursor-pointer"
            onClick={() => setOverrideConfig(row.original)}
          >
            {row.original.key}
          </button>
        ),
        valueType: ({ row }) => {
          const typeInfo = valueTypeMap[row.original.valueType];
          return typeInfo ? (
            <Badge variant={typeInfo.variant}>{typeInfo.label}</Badge>
          ) : (
            <span>{row.original.valueType}</span>
          );
        },
        scope: ({ row }) => {
          const scopeInfo = scopeVariantMap[row.original.scope];
          return scopeInfo ? (
            <Badge variant={scopeInfo.variant}>{scopeInfo.label}</Badge>
          ) : (
            <span>{row.original.scope}</span>
          );
        },
        actions: ({ row }) => {
          const config = row.original;
          return (
            <div className="inline-flex items-center gap-1">
              <Button
                variant="ghost"
                size="xs"
                onClick={() => setOverrideConfig(config)}
              >
                {t('SysConfigMgmt.action.override', '租户覆盖')}
              </Button>
              <Button
                variant="ghost"
                size="xs"
                onClick={() => setEditConfig(config)}
              >
                {t('SysConfigMgmt.action.edit', '编辑')}
              </Button>
              <Button
                variant="ghost"
                size="xs"
                className="text-destructive hover:text-destructive"
                onClick={() => handleDelete(config)}
              >
                {t('SysConfigMgmt.action.delete', '删除')}
              </Button>
            </div>
          );
        },
      }) as ProTableColumnDef<SysConfigResponse>[],
    [handleDelete, t, valueTypeMap, scopeVariantMap],
  );

  return (
    <>
      <ProTable
        ref={tableRef}
        columns={columns}
        request={(params) =>
          listGlobalConfigs({
            page: params.page,
            pageSize: params.pageSize,
          })
        }
        header={{
          title: t('SysConfigMgmt.title', '配置中心'),
          toolbar: (
            <Button onClick={() => setCreateOpen(true)}>
              {t('SysConfigMgmt.action.create', '新建配置')}
            </Button>
          ),
        }}
        initialColumnPinning={{ left: ['key'], right: ['actions'] }}
      />

      <SysConfigDialog
        open={createOpen || !!editConfig}
        config={editConfig}
        onOpenChange={(open) => {
          if (!open) {
            setCreateOpen(false);
            setEditConfig(null);
          }
        }}
        onSuccess={() => {
          setCreateOpen(false);
          setEditConfig(null);
          handleSuccess();
        }}
      />

      <TenantOverrideSheet
        config={overrideConfig}
        open={!!overrideConfig}
        onOpenChange={(open) => {
          if (!open) setOverrideConfig(null);
        }}
        onRefresh={handleSuccess}
      />
    </>
  );
};

export default SysConfigsPage;
