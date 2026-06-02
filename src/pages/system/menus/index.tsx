import { useCallback, useMemo, useRef, useState } from 'react';
import type { ProTableColumnDef, ProTableRef } from '@/components/pro-table';
import { buildColumns, ProTable } from '@/components/pro-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useT } from '@/i18n';
import type { MergedMenuTreeResponse } from '@/types/api';
import { toast } from '@/utils/toast';
import { useMenusAgent } from './agent';
import { MenuOverrideDialog } from './MenuOverrideDialog';
import {
  createMenuTableColumns,
  deleteMenuOverride,
  getTenantMenuTree,
} from './options';

const MenusPage = () => {
  const t = useT();
  // Register all page capabilities via the agent hook
  useMenusAgent();

  const [editMenu, setEditMenu] = useState<MergedMenuTreeResponse | null>(null);
  const tableRef = useRef<ProTableRef>(null);

  const menuTypeMap = useMemo<
    Record<
      string,
      { label: string; variant: 'default' | 'secondary' | 'outline' }
    >
  >(
    () => ({
      directory: {
        label: t('MenuMgmt.typeDirectory', '目录'),
        variant: 'secondary',
      },
      menu: { label: t('MenuMgmt.typeMenu', '菜单'), variant: 'default' },
      button: { label: t('MenuMgmt.typeButton', '按钮'), variant: 'outline' },
    }),
    [t],
  );

  const handleSuccess = useCallback(() => {
    tableRef.current?.refresh();
  }, []);

  const handleResetOverride = useCallback(
    (menu: MergedMenuTreeResponse) => {
      void deleteMenuOverride(menu.id).then(() => {
        toast.success(t('MenuMgmt.toast.resetSuccess', '恢复默认成功'));
        handleSuccess();
      });
    },
    [handleSuccess, t],
  );

  const columns = useMemo(
    () =>
      buildColumns<MergedMenuTreeResponse>(createMenuTableColumns(t), {
        type: ({ row }) => {
          const typeInfo = menuTypeMap[row.original.type];
          return typeInfo ? (
            <Badge variant={typeInfo.variant}>{typeInfo.label}</Badge>
          ) : (
            <span>{row.original.type}</span>
          );
        },
        actions: ({ row }) => {
          const menu = row.original;
          return (
            <div className="inline-flex items-center gap-1">
              <Button
                variant="ghost"
                size="xs"
                onClick={() => setEditMenu(menu)}
              >
                {t('MenuMgmt.btn.customize', '自定义')}
              </Button>
              <Button
                variant="ghost"
                size="xs"
                className="text-destructive hover:text-destructive"
                onClick={() => handleResetOverride(menu)}
              >
                {t('MenuMgmt.btn.resetDefault', '恢复默认')}
              </Button>
            </div>
          );
        },
      }) as ProTableColumnDef<MergedMenuTreeResponse>[],
    [handleResetOverride, t, menuTypeMap],
  );

  return (
    <>
      <ProTable
        ref={tableRef}
        columns={columns}
        request={() => getTenantMenuTree()}
        header={{
          title: t('MenuMgmt.title', '租户菜单配置'),
        }}
        search={false}
        pagination={false}
        getSubRows={(row) => row.children}
        initialColumnPinning={{ left: ['name'], right: ['actions'] }}
      />

      <MenuOverrideDialog
        open={!!editMenu}
        menu={editMenu}
        onOpenChange={(open) => {
          if (!open) setEditMenu(null);
        }}
        onSuccess={() => {
          setEditMenu(null);
          handleSuccess();
        }}
      />
    </>
  );
};

export default MenusPage;
