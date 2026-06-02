import { useCallback, useMemo, useRef, useState } from 'react';
import type { ProTableColumnDef, ProTableRef } from '@/components/pro-table';
import { buildColumns, ProTable } from '@/components/pro-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { useT } from '@/i18n';
import type { SysMenuTreeResponse } from '@/types/api';
import { toast } from '@/utils/toast';
import { useSysMenusAgent } from './agent';
import {
  createSysMenuTableColumns,
  deleteSysMenu,
  getSysMenuTree,
} from './options';
import { SysMenuDialog } from './SysMenuDialog';

const SysMenusPage = () => {
  const t = useT();

  // Register all page capabilities via the agent hook
  useSysMenusAgent();

  const [createOpen, setCreateOpen] = useState(false);
  const [editMenu, setEditMenu] = useState<SysMenuTreeResponse | null>(null);
  const [parentMenu, setParentMenu] = useState<SysMenuTreeResponse | null>(
    null,
  );
  const tableRef = useRef<ProTableRef>(null);

  const handleSuccess = useCallback(() => {
    tableRef.current?.refresh();
  }, []);

  const handleDelete = useCallback(
    (menu: SysMenuTreeResponse) => {
      void deleteSysMenu(menu.id).then(() => {
        toast.success(t('SysMenuMgmt.toast.deleted', '删除成功'));
        handleSuccess();
      });
    },
    [handleSuccess, t],
  );

  const columns = useMemo(() => {
    // biome-ignore lint/style/useNamingConvention: inline constant
    const MENU_TYPE_MAP: Record<
      string,
      { label: string; variant: 'default' | 'secondary' | 'outline' }
    > = {
      directory: {
        label: t('SysMenuMgmt.typeDirectory', '目录'),
        variant: 'secondary',
      },
      menu: { label: t('SysMenuMgmt.typeMenu', '菜单'), variant: 'default' },
      button: {
        label: t('SysMenuMgmt.typeButton', '按钮'),
        variant: 'outline',
      },
    };

    return buildColumns<SysMenuTreeResponse>(createSysMenuTableColumns(t), {
      type: ({ row }) => {
        const typeInfo = MENU_TYPE_MAP[row.original.type];
        return typeInfo ? (
          <Badge variant={typeInfo.variant}>{typeInfo.label}</Badge>
        ) : (
          <span>{row.original.type}</span>
        );
      },
      status: ({ row }) => {
        const isActive = row.original.status === 'active';
        return (
          <Badge variant={isActive ? 'default' : 'destructive'}>
            {isActive
              ? t('SysMenuMgmt.badge.enabled', '启用')
              : t('SysMenuMgmt.badge.disabled', '禁用')}
          </Badge>
        );
      },
      isCache: ({ row }) => <Switch checked={row.original.isCache} disabled />,
      actions: ({ row }) => {
        const menu = row.original;
        const canHaveChildren =
          menu.type === 'directory' || menu.type === 'menu';
        return (
          <div className="inline-flex items-center gap-1">
            {canHaveChildren && (
              <Button
                variant="ghost"
                size="xs"
                onClick={() => {
                  setParentMenu(menu);
                  setCreateOpen(true);
                }}
              >
                {t('SysMenuMgmt.btn.addChild', '添加子菜单')}
              </Button>
            )}
            <Button variant="ghost" size="xs" onClick={() => setEditMenu(menu)}>
              {t('SysMenuMgmt.btn.edit', '编辑')}
            </Button>
            <Button
              variant="ghost"
              size="xs"
              className="text-destructive hover:text-destructive"
              onClick={() => handleDelete(menu)}
            >
              {t('SysMenuMgmt.btn.delete', '删除')}
            </Button>
          </div>
        );
      },
    }) as ProTableColumnDef<SysMenuTreeResponse>[];
  }, [handleDelete, t]);

  return (
    <>
      <ProTable
        ref={tableRef}
        columns={columns}
        request={() => getSysMenuTree()}
        header={{
          title: t('SysMenuMgmt.title', '系统菜单管理'),
          toolbar: (
            <Button
              onClick={() => {
                setParentMenu(null);
                setCreateOpen(true);
              }}
            >
              {t('SysMenuMgmt.btn.create', '新建菜单')}
            </Button>
          ),
        }}
        search={false}
        pagination={false}
        getSubRows={(row) => row.children}
        initialColumnPinning={{ left: ['name'], right: ['actions'] }}
      />

      <SysMenuDialog
        open={createOpen || !!editMenu}
        menu={editMenu}
        parentMenu={parentMenu}
        onOpenChange={(open) => {
          if (!open) {
            setCreateOpen(false);
            setEditMenu(null);
            setParentMenu(null);
          }
        }}
        onSuccess={() => {
          setCreateOpen(false);
          setEditMenu(null);
          setParentMenu(null);
          handleSuccess();
        }}
      />
    </>
  );
};

export default SysMenusPage;
