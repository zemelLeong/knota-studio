import { useRequest } from 'ahooks';
import { useMemo, useRef } from 'react';
import { ProFormDialog } from '@/components/form/pro-form-dialog';
import type { FieldConfig } from '@/components/form/types';
import { useT } from '@/i18n';
import type { SysMenuTreeResponse } from '@/types/api';
import {
  createSysMenuCreateFields,
  createSysMenuEditFields,
  createSysMenuExecutor,
  getSysMenuTree,
  updateSysMenuExecutor,
} from './options';

interface SysMenuDialogProps {
  open: boolean;
  menu: SysMenuTreeResponse | null;
  parentMenu?: SysMenuTreeResponse | null;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

const SysMenuDialog = ({
  open,
  menu,
  parentMenu,
  onOpenChange,
  onSuccess,
}: SysMenuDialogProps) => {
  const t = useT();
  const lockedMenuRef = useRef(menu);
  const lockedParentRef = useRef(parentMenu);
  if (open) {
    lockedMenuRef.current = menu;
    lockedParentRef.current = parentMenu;
  }
  const editMenu = lockedMenuRef.current;
  const isEdit = !!editMenu;

  const { data: menuTree } = useRequest(getSysMenuTree, { ready: open });

  // Inject tree items into the parentId field
  const fields = useMemo(() => {
    const base = isEdit
      ? createSysMenuEditFields(t)
      : createSysMenuCreateFields(t);
    return base.map(
      (f): FieldConfig =>
        f.name === 'parentId'
          ? {
              ...f,
              treeItems: (menuTree ?? []).filter(
                (m: SysMenuTreeResponse) => m.id !== editMenu?.id,
              ),
            }
          : f,
    );
  }, [isEdit, t, menuTree, editMenu?.id]);

  const handleSubmit = async (values: Record<string, unknown>) => {
    const parentId =
      values.parentId && (values.parentId as string).trim() !== ''
        ? (values.parentId as string)
        : null;

    if (isEdit) {
      await updateSysMenuExecutor(t)({
        ...values,
        parentId,
        id: editMenu.id,
        version: editMenu.version,
      });
    } else {
      await createSysMenuExecutor(t)({
        ...values,
        parentId,
      });
    }
    onSuccess();
    onOpenChange(false);
  };

  const lockedParent = lockedParentRef.current;
  let title = t('SysMenuMgmt.dialog.create', '新建菜单');
  if (isEdit) {
    title = t('SysMenuMgmt.dialog.edit', '编辑菜单');
  } else if (lockedParent) {
    title = t(
      'SysMenuMgmt.dialog.createChild',
      '为「{name}」添加子菜单',
    ).replace('{name}', lockedParent.name);
  }

  let desc = t('SysMenuMgmt.dialog.createDesc', '创建顶层菜单');
  if (isEdit) {
    desc = t('SysMenuMgmt.dialog.editDesc', '修改菜单信息');
  } else if (lockedParent) {
    desc = t(
      'SysMenuMgmt.dialog.createChildDesc',
      '在「{name}」下创建下级菜单或按钮',
    ).replace('{name}', lockedParent.name);
  }

  let editValues: Record<string, unknown> | undefined;
  if (isEdit) {
    editValues = {
      name: editMenu.name,
      type: editMenu.type,
      parentId: editMenu.parentId ?? '',
      path: editMenu.path ?? '',
      alias: editMenu.alias ?? '',
      icon: editMenu.icon ?? '',
      sortOrder: editMenu.sortOrder,
      isCache: editMenu.isCache,
      status: editMenu.status,
      remark: editMenu.remark ?? '',
    };
  } else if (lockedParent) {
    editValues = { parentId: lockedParent.id };
  }

  return (
    <ProFormDialog
      key={
        isEdit
          ? `edit-${editMenu?.id}`
          : `create-${lockedParentRef.current?.id ?? 'root'}`
      }
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={desc}
      fields={fields}
      editValues={editValues}
      onSubmit={handleSubmit}
    />
  );
};

export type { SysMenuDialogProps };
export { SysMenuDialog };
