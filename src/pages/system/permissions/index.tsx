import { Icon } from '@iconify/react';
import { useCallback, useMemo, useRef, useState } from 'react';
import type { ProTableColumnDef, ProTableRef } from '@/components/pro-table';
import { buildColumns, ProTable } from '@/components/pro-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useT } from '@/i18n';
import type { PaginatedResponse } from '@/types/common';
import type { MergedPermission, PermissionResponse } from '@/types/permission';
import { toast } from '@/utils/toast';
import { usePermissionsAgent } from './agent';
import {
  createMethodFilterOptions,
  createPermTableColumns,
  deletePermission,
  getPermissionsWithMetadata,
  mergePermissionData,
  syncPermissions,
} from './options';
import { PermissionDialog } from './PermissionDialog';

const methodBadgeClass: Record<string, string> = {
  get: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  post: 'bg-blue-100 text-blue-800 border-blue-200',
  put: 'bg-amber-100 text-amber-800 border-amber-200',
  delete: 'bg-red-100 text-red-800 border-red-200',
};

const PermissionsPage = () => {
  const t = useT();
  usePermissionsAgent();

  const [editPermission, setEditPermission] =
    useState<PermissionResponse | null>(null);
  const tableRef = useRef<ProTableRef>(null);

  // Filter states
  const [keyword, setKeyword] = useState('');
  const [methodFilter, setMethodFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');

  const permissionTableColumns = useMemo(() => createPermTableColumns(t), [t]);
  const methodOptions = useMemo(() => createMethodFilterOptions(t), [t]);

  const triggerRefresh = useCallback(() => {
    tableRef.current?.refresh();
  }, []);

  const handleDelete = useCallback(
    (permissionId: string) => {
      void deletePermission(permissionId).then(() => {
        toast.success(t('PermMgmt.toast.deleted', '权限删除成功'));
        triggerRefresh();
      });
    },
    [triggerRefresh, t],
  );

  const handleSyncSingle = useCallback(
    (path: string, method: string) => {
      void syncPermissions({ items: [{ path, method }] }).then(() => {
        toast.success(t('PermMgmt.toast.synced', '同步成功'));
        triggerRefresh();
      });
    },
    [triggerRefresh, t],
  );

  const handleBatchSync = useCallback(() => {
    void getPermissionsWithMetadata().then((metadata) => {
      const items = (metadata.unmatchedRoutes ?? []).map((r) => ({
        path: r.path,
        method: r.method,
      }));
      if (items.length === 0) {
        toast.info(t('PermMgmt.toast.noSyncNeeded', '无待同步路由'));
        return;
      }
      return syncPermissions({ items }).then(() => {
        toast.success(t('PermMgmt.toast.synced', '同步成功'));
        triggerRefresh();
      });
    });
  }, [triggerRefresh, t]);

  const handleBatchClear = useCallback(() => {
    void getPermissionsWithMetadata().then((metadata) => {
      const staleIds = (metadata.permissions ?? [])
        .filter((p) => p.tag === '' && p.description === '')
        .map((p) => p.id);
      if (staleIds.length === 0) {
        toast.info(
          t('PermMgmt.toast.noStalePermissions', '没有需要清理的失效权限'),
        );
        return;
      }
      return Promise.all(staleIds.map((id) => deletePermission(id))).then(
        () => {
          toast.success(t('PermMgmt.toast.batchClearSuccess', '批量清理成功'));
          triggerRefresh();
        },
      );
    });
  }, [triggerRefresh, t]);

  const columns = useMemo(
    () =>
      buildColumns<MergedPermission>(permissionTableColumns, {
        method: ({ row }) => {
          const method = row.original.method.toUpperCase();
          const cls = methodBadgeClass[method.toLowerCase()];
          return cls ? (
            <Badge variant="outline" className={cls}>
              {method}
            </Badge>
          ) : (
            <Badge variant="outline">{method}</Badge>
          );
        },
        status: ({ row }) => {
          const status = row.original.status;
          if (status === 'active') {
            return (
              <Badge className="border-emerald-600 bg-emerald-600 text-white">
                {t('PermMgmt.statusActive', '已配置')}
              </Badge>
            );
          }
          if (status === 'new') {
            return (
              <Badge className="border-amber-200 bg-amber-100 text-amber-800">
                {t('PermMgmt.statusNew', '新增')}
              </Badge>
            );
          }
          return (
            <Badge variant="destructive">
              {t('PermMgmt.statusStale', '已失效')}
            </Badge>
          );
        },
        isSystem: ({ row }) => (
          <Switch checked={row.original.isSystem ?? false} disabled />
        ),
        path: ({ row }) => {
          const isStale = row.original.status === 'stale';
          return (
            <span
              className={
                isStale ? 'rounded bg-red-50 px-1.5 py-0.5 text-red-700' : ''
              }
            >
              {row.original.path}
            </span>
          );
        },
        description: ({ row }) => {
          const isStale = row.original.status === 'stale';
          return (
            <span className={isStale ? 'text-red-700' : ''}>
              {row.original.description}
            </span>
          );
        },
        tag: ({ row }) => {
          const isStale = row.original.status === 'stale';
          return (
            <span className={isStale ? 'text-red-700' : ''}>
              {row.original.tag}
            </span>
          );
        },
        actions: ({ row }) => {
          const item = row.original;
          if (item.status === 'active') {
            return (
              <div className="inline-flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() =>
                    setEditPermission({
                      id: item.permissionId ?? item.id,
                      name: item.name ?? '',
                      code: '',
                      obj: item.path,
                      act: item.method,
                      permissionType: 'api',
                      isSystem: item.isSystem ?? false,
                      version: item.version ?? 0,
                    })
                  }
                >
                  <Icon icon="mdi:pencil-outline" className="mr-1 size-3.5" />
                  {t('PermMgmt.btn.edit', '编辑')}
                </Button>
                <Button
                  variant="ghost"
                  size="xs"
                  className="text-destructive hover:text-destructive"
                  disabled={item.isSystem}
                  onClick={() => {
                    if (item.permissionId) {
                      handleDelete(item.permissionId);
                    }
                  }}
                >
                  <Icon icon="mdi:delete-outline" className="mr-1 size-3.5" />
                  {t('PermMgmt.btn.delete', '删除')}
                </Button>
              </div>
            );
          }
          if (item.status === 'new') {
            return (
              <div className="inline-flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => handleSyncSingle(item.path, item.method)}
                >
                  <Icon icon="mdi:sync" className="mr-1 size-3.5" />
                  {t('PermMgmt.btn.sync', '同步')}
                </Button>
              </div>
            );
          }
          // stale
          return (
            <div className="inline-flex items-center gap-1">
              <Button
                variant="ghost"
                size="xs"
                className="text-destructive hover:text-destructive"
                onClick={() => {
                  if (item.permissionId) {
                    handleDelete(item.permissionId);
                  }
                }}
              >
                <Icon
                  icon="mdi:close-circle-outline"
                  className="mr-1 size-3.5"
                />
                {t('PermMgmt.btn.clear', '清理')}
              </Button>
            </div>
          );
        },
      }) as ProTableColumnDef<MergedPermission>[],
    [permissionTableColumns, t, handleDelete, handleSyncSingle],
  );

  const handleFetchRequest = useCallback(
    async (params: {
      page: number;
      pageSize: number;
      [key: string]: unknown;
    }): Promise<PaginatedResponse<MergedPermission>> => {
      const kw = (params.keyword as string) ?? '';
      const mf = (params.methodFilter as string) ?? '';
      const sf = (params.statusFilter as string) ?? '';

      const metadata = await getPermissionsWithMetadata();
      const merged = mergePermissionData(
        metadata.permissions ?? [],
        metadata.unmatchedRoutes ?? [],
        t,
      );

      const filtered = merged.filter((item) => {
        if (kw) {
          const lower = kw.toLowerCase();
          const matchesKeyword =
            item.tag.toLowerCase().includes(lower) ||
            item.path.toLowerCase().includes(lower) ||
            item.description.toLowerCase().includes(lower) ||
            (item.name?.toLowerCase().includes(lower) ?? false);
          if (!matchesKeyword) return false;
        }
        if (mf && item.method.toUpperCase() !== mf) return false;
        if (sf && item.status !== sf) return false;
        return true;
      });

      const page = params.page;
      const pageSize = params.pageSize;
      const start = (page - 1) * pageSize;
      const items = filtered.slice(start, start + pageSize);

      return {
        items,
        totalItems: filtered.length,
        totalPages: Math.ceil(filtered.length / pageSize),
        page,
        pageSize,
      };
    },
    [t],
  );

  return (
    <>
      <ProTable
        ref={tableRef}
        columns={columns}
        request={handleFetchRequest}
        search={false}
        params={{ keyword, methodFilter, statusFilter }}
        header={{
          title: t('PermMgmt.title', '权限管理'),
          toolbar: (
            <div className="flex items-center gap-2">
              <Input
                placeholder={t(
                  'PermMgmt.placeholderSearch',
                  '搜索模块/路由/说明',
                )}
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                className="w-60"
              />
              <Select
                value={methodFilter || '__all_method__'}
                onValueChange={(val) =>
                  setMethodFilter(val === '__all_method__' ? '' : val)
                }
              >
                <SelectTrigger size="sm" className="w-28">
                  <SelectValue
                    placeholder={t('PermMgmt.filterMethod', '请求方法')}
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all_method__">
                    {t('PermMgmt.filterAll', '全部')}
                  </SelectItem>
                  {methodOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={statusFilter || '__all_status__'}
                onValueChange={(val) =>
                  setStatusFilter(val === '__all_status__' ? '' : val)
                }
              >
                <SelectTrigger size="sm" className="w-28">
                  <SelectValue
                    placeholder={t('PermMgmt.filterStatus', '状态')}
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all_status__">
                    {t('PermMgmt.filterAll', '全部')}
                  </SelectItem>
                  <SelectItem value="active">
                    {t('PermMgmt.statusActive', '已配置')}
                  </SelectItem>
                  <SelectItem value="new">
                    {t('PermMgmt.statusNew', '新增')}
                  </SelectItem>
                  <SelectItem value="stale">
                    {t('PermMgmt.statusStale', '已失效')}
                  </SelectItem>
                </SelectContent>
              </Select>
              <Button variant="outline" size="sm" onClick={handleBatchSync}>
                <Icon icon="mdi:sync" className="mr-1 size-4" />
                {t('PermMgmt.actionBatchSync', '批量同步')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={handleBatchClear}
              >
                <Icon icon="mdi:delete-sweep-outline" className="mr-1 size-4" />
                {t('PermMgmt.actionBatchClear', '批量清理')}
              </Button>
            </div>
          ),
        }}
        initialColumnPinning={{ left: ['tag'], right: ['actions'] }}
      />

      <PermissionDialog
        open={!!editPermission}
        permission={editPermission}
        onOpenChange={(open) => {
          if (!open) {
            setEditPermission(null);
          }
        }}
        onSuccess={triggerRefresh}
      />
    </>
  );
};

export default PermissionsPage;
