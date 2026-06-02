import { useCallback, useMemo, useRef, useState } from 'react';
import type { ProTableColumnDef, ProTableRef } from '@/components/pro-table';
import { buildColumns, ProTable } from '@/components/pro-table';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { useT } from '@/i18n';
import type { TenantResponse } from '@/types/user';
import { toast } from '@/utils/toast';
import { useTenantsAgent } from './agent';
import { CreateAdminDialog } from './CreateAdminDialog';
import { createTenantTableColumns, listTenants, updateTenant } from './options';
import { TenantDialog } from './TenantDialog';

const TenantsPage = () => {
  const t = useT();

  // Register all page capabilities via the agent hook
  useTenantsAgent();

  const [createOpen, setCreateOpen] = useState(false);
  const [editTenant, setEditTenant] = useState<TenantResponse | null>(null);
  const [adminTenant, setAdminTenant] = useState<TenantResponse | null>(null);
  const tableRef = useRef<ProTableRef>(null);

  const handleSuccess = useCallback(() => {
    tableRef.current?.refresh();
  }, []);

  const handleToggleStatus = useCallback(
    (tenant: TenantResponse, status: 'active' | 'disabled') => {
      void updateTenant(tenant.id, { status }).then(() => {
        toast.success(t('TenantMgmt.toast.statusUpdated', '状态更新成功'));
        handleSuccess();
      });
    },
    [handleSuccess, t],
  );

  const tenantTableColumns = useMemo(() => createTenantTableColumns(t), [t]);

  const columns = useMemo(
    () =>
      buildColumns<TenantResponse>(tenantTableColumns, {
        status: ({ row }) => {
          const tenant = row.original;
          const isActive = tenant.status === 'active';
          return (
            <div className="inline-flex items-center gap-2">
              <Switch
                checked={isActive}
                onCheckedChange={(checked) => {
                  handleToggleStatus(tenant, checked ? 'active' : 'disabled');
                }}
              />
              <span className="text-sm">
                {isActive
                  ? t('TenantMgmt.badge.enabled', '启用')
                  : t('TenantMgmt.badge.disabled', '禁用')}
              </span>
            </div>
          );
        },
        description: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {row.original.description ?? '—'}
          </span>
        ),
        actions: ({ row }) => {
          const tenant = row.original;
          return (
            <div className="inline-flex items-center gap-1">
              <Button
                variant="ghost"
                size="xs"
                onClick={() => setEditTenant(tenant)}
              >
                {t('TenantMgmt.action.edit', '编辑')}
              </Button>
              <Button
                variant="ghost"
                size="xs"
                onClick={() => setAdminTenant(tenant)}
              >
                {t('TenantMgmt.action.createAdmin', '创建租户管理员')}
              </Button>
            </div>
          );
        },
      }) as ProTableColumnDef<TenantResponse>[],
    [handleToggleStatus, tenantTableColumns, t],
  );

  return (
    <>
      <ProTable
        ref={tableRef}
        columns={columns}
        request={(params) =>
          listTenants({
            page: params.page as number,
            pageSize: params.pageSize as number,
            name: params.name as string | undefined,
            code: params.code as string | undefined,
            status: params.status as string | undefined,
          })
        }
        header={{
          title: t('TenantMgmt.title', '租户管理'),
          toolbar: (
            <Button onClick={() => setCreateOpen(true)}>
              {t('TenantMgmt.action.create', '新建租户')}
            </Button>
          ),
        }}
        search={{ defaultCollapsed: false }}
        initialColumnPinning={{ left: ['name', 'code'], right: ['actions'] }}
      />

      <TenantDialog
        open={createOpen || !!editTenant}
        tenant={editTenant}
        onOpenChange={(open) => {
          if (!open) {
            setCreateOpen(false);
            setEditTenant(null);
          }
        }}
        onSuccess={() => {
          setCreateOpen(false);
          setEditTenant(null);
          handleSuccess();
        }}
      />

      <CreateAdminDialog
        open={!!adminTenant}
        tenant={adminTenant}
        onOpenChange={(open) => {
          if (!open) setAdminTenant(null);
        }}
        onSuccess={handleSuccess}
      />
    </>
  );
};

export default TenantsPage;
