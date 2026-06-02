import { useRequest } from 'ahooks';
import { useCallback, useMemo, useRef, useState } from 'react';
import type { ProTableColumnDef, ProTableRef } from '@/components/pro-table';
import { buildColumns, ProTable } from '@/components/pro-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { useT } from '@/i18n';
import { useAuth } from '@/stores/auth';
import type { RoleResponse } from '@/types/user';
import { toast } from '@/utils/toast';
import { useRolesAgent } from './agent';
import { MenuAssignDialog } from './MenuAssignDialog';
import {
  createRoleTableColumns,
  getAllTenants,
  listRoles,
  toggleRoleStatus,
} from './options';
import { PermissionAssignDialog } from './PermissionAssignDialog';
import { RoleDialog } from './RoleDialog';

const RolesPage = () => {
  const t = useT();
  useRolesAgent();
  const { user } = useAuth();
  const isSuperAdmin = user?.isSuperAdmin ?? false;

  const [createOpen, setCreateOpen] = useState(false);
  const [editRole, setEditRole] = useState<RoleResponse | null>(null);
  const [permissionRole, setPermissionRole] = useState<RoleResponse | null>(
    null,
  );
  const [menuRole, setMenuRole] = useState<RoleResponse | null>(null);
  const tableRef = useRef<ProTableRef>(null);

  const { data: tenantsData } = useRequest(getAllTenants);

  const tenantOptions = useMemo(
    () =>
      (tenantsData?.items ?? []).map((item) => ({
        value: item.code,
        label: item.name,
      })),
    [tenantsData],
  );

  const handleSuccess = useCallback(() => {
    tableRef.current?.refresh();
  }, []);

  const handleToggleStatus = useCallback(
    (role: RoleResponse, status: 'active' | 'disabled') => {
      void toggleRoleStatus(role.id, status).then(() => {
        toast.success(t('RoleMgmt.toast.statusUpdated', '状态更新成功'));
        handleSuccess();
      });
    },
    [handleSuccess, t],
  );

  const columns = useMemo(() => {
    const columnOpts = createRoleTableColumns(t).map((col) =>
      col.key === 'tenantName' && isSuperAdmin
        ? {
            ...col,
            search: {
              type: 'select' as const,
              placeholder: t('RoleMgmt.tenantPlaceholder', '筛选租户'),
              options: tenantOptions,
              transform: (value: unknown) => ({ tenantCode: value }),
              order: 3,
            },
          }
        : col,
    );
    return buildColumns<RoleResponse>(columnOpts, {
      isSystem: ({ row }) => {
        const role = row.original;
        return role.isSystem ? (
          <Badge variant="secondary">
            {t('RoleMgmt.badge.system', '系统')}
          </Badge>
        ) : (
          <Badge variant="outline">
            {t('RoleMgmt.badge.custom', '自定义')}
          </Badge>
        );
      },
      status: ({ row }) => {
        const role = row.original;
        const isActive = role.status === 'active';
        return (
          <div className="inline-flex items-center gap-2">
            <Switch
              checked={isActive}
              onCheckedChange={(checked) => {
                handleToggleStatus(role, checked ? 'active' : 'disabled');
              }}
            />
            <span className="text-sm">
              {isActive
                ? t('RoleMgmt.badge.enabled', '启用')
                : t('RoleMgmt.badge.disabled', '禁用')}
            </span>
          </div>
        );
      },
      description: ({ row }) => {
        const desc = row.original.description;
        return (
          <span className="text-sm text-muted-foreground">{desc ?? '—'}</span>
        );
      },
      actions: ({ row }) => {
        const role = row.original;
        return (
          <div className="inline-flex items-center gap-1">
            <Button variant="ghost" size="xs" onClick={() => setEditRole(role)}>
              {t('RoleMgmt.action.edit', '编辑')}
            </Button>
            <Button
              variant="ghost"
              size="xs"
              onClick={() => setPermissionRole(role)}
            >
              {t('RoleMgmt.action.assignPerms', '分配权限')}
            </Button>
            <Button variant="ghost" size="xs" onClick={() => setMenuRole(role)}>
              {t('RoleMgmt.action.assignMenus', '分配菜单')}
            </Button>
          </div>
        );
      },
    }) as ProTableColumnDef<RoleResponse>[];
  }, [handleToggleStatus, t, tenantOptions, isSuperAdmin]);

  return (
    <>
      <ProTable
        ref={tableRef}
        columns={columns}
        request={(params) =>
          listRoles({
            page: params.page as number,
            pageSize: params.pageSize as number,
            name: params.name as string | undefined,
            status: params.status as string | undefined,
            tenantCode: params.tenantCode as string | undefined,
          })
        }
        header={{
          title: t('RoleMgmt.title', '角色管理'),
          toolbar: (
            <Button onClick={() => setCreateOpen(true)}>
              {t('RoleMgmt.action.createRole', '创建角色')}
            </Button>
          ),
        }}
        search={{ defaultCollapsed: false }}
        initialColumnPinning={{ left: ['name'], right: ['actions'] }}
      />

      <RoleDialog
        open={createOpen || !!editRole}
        role={editRole}
        onOpenChange={(open) => {
          if (!open) {
            setCreateOpen(false);
            setEditRole(null);
          }
        }}
        onSuccess={() => {
          setCreateOpen(false);
          setEditRole(null);
          handleSuccess();
        }}
      />

      <PermissionAssignDialog
        open={!!permissionRole}
        role={permissionRole}
        onOpenChange={(open) => {
          if (!open) setPermissionRole(null);
        }}
        onSuccess={handleSuccess}
      />

      <MenuAssignDialog
        open={!!menuRole}
        role={menuRole}
        onOpenChange={(open) => {
          if (!open) setMenuRole(null);
        }}
        onSuccess={handleSuccess}
      />
    </>
  );
};

export default RolesPage;
