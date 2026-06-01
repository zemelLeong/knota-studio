import { Icon } from '@iconify/react';
import { useRequest } from 'ahooks';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { CheckboxTreeNode } from '@/components/ui/checkbox-tree';
import { CheckboxTree } from '@/components/ui/checkbox-tree';
import { Input } from '@/components/ui/input';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { useT } from '@/i18n';
import type { MergedMenuTreeResponse } from '@/types/api';
import type { RoleResponse } from '@/types/user';
import { toast } from '@/utils/toast';
import { getAssignableMenus, syncRoleMenus } from './options';

interface MenuAssignDialogProps {
  open: boolean;
  role: RoleResponse | null;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

// ─── Tree helpers ────────────────────────────────────────────────

function convertMenuTree(items: MergedMenuTreeResponse[]): CheckboxTreeNode[] {
  return items.map((item) => ({
    key: item.id,
    label: item.name,
    children:
      item.children.length > 0 ? convertMenuTree(item.children) : undefined,
  }));
}

function collectAllTreeKeys(nodes: CheckboxTreeNode[]): string[] {
  return nodes.reduce<string[]>((acc, node) => {
    acc.push(node.key);
    if (node.children) {
      acc.push(...collectAllTreeKeys(node.children));
    }
    return acc;
  }, []);
}

/**
 * Group-based filter for menu tree.
 * - Directory matches → all children shown (browse the directory).
 * - Child matches → ancestor directories shown with only matching items.
 * - Nothing matches → hidden.
 */
function filterMenuTree(
  nodes: CheckboxTreeNode[],
  search: string,
): CheckboxTreeNode[] {
  if (!search.trim()) return nodes;
  const term = search.toLowerCase().trim();

  function matches(node: CheckboxTreeNode): boolean {
    return node.label.toLowerCase().includes(term);
  }

  function filter(node: CheckboxTreeNode): CheckboxTreeNode | null {
    if (!node.children || node.children.length === 0) {
      return matches(node) ? node : null;
    }
    const children = node.children;

    const filtered = children
      .map(filter)
      .filter((c): c is CheckboxTreeNode => c !== null);

    if (matches(node)) {
      return { ...node, children };
    }
    if (filtered.length > 0) {
      return { ...node, children: filtered };
    }
    return null;
  }

  return nodes.map(filter).filter((n): n is CheckboxTreeNode => n !== null);
}

// ─── Component ───────────────────────────────────────────────────

const MenuAssignDialog = ({
  open,
  role,
  onOpenChange,
  onSuccess,
}: MenuAssignDialogProps) => {
  const t = useT();
  const [checkedKeys, setCheckedKeys] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [expandAll, setExpandAll] = useState(false);

  const { data: assignableData, loading } = useRequest(
    () => getAssignableMenus(role?.id ?? ''),
    {
      ready: open && !!role,
      refreshDeps: [open],
    },
  );

  useEffect(() => {
    if (assignableData?.assignedMenuIds) {
      setCheckedKeys(new Set(assignableData.assignedMenuIds));
    }
  }, [assignableData?.assignedMenuIds]);

  useEffect(() => {
    if (!open) {
      setCheckedKeys(new Set());
      setSearch('');
      setExpandAll(false);
    }
  }, [open]);

  const menuNodes = assignableData?.menus ?? [];
  const fullTree = useMemo(() => convertMenuTree(menuNodes), [menuNodes]);
  const displayTree = useMemo(
    () => filterMenuTree(fullTree, search),
    [fullTree, search],
  );
  const visibleKeys = useMemo(
    () => collectAllTreeKeys(displayTree),
    [displayTree],
  );

  const handleSelectAll = useCallback(() => {
    setCheckedKeys(new Set(visibleKeys));
  }, [visibleKeys]);

  const handleClearAll = useCallback(() => {
    const next = new Set(checkedKeys);
    for (const key of visibleKeys) {
      next.delete(key);
    }
    setCheckedKeys(next);
  }, [visibleKeys, checkedKeys]);

  const handleToggleExpand = useCallback(() => {
    setExpandAll((prev) => !prev);
  }, []);

  const { run: submit, loading: submitting } = useRequest(
    () => syncRoleMenus(role?.id ?? '', [...checkedKeys]),
    {
      manual: true,
      onSuccess: () => {
        toast.success(t('RoleMgmt.toast.menusAssigned', '菜单分配成功'));
        onSuccess();
        onOpenChange(false);
      },
    },
  );

  let content: ReactNode;
  if (loading) {
    content = (
      <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
        {t('RoleMgmt.loading', '加载中...')}
      </div>
    );
  } else if (menuNodes.length === 0) {
    content = (
      <p className="p-4 text-sm text-muted-foreground">
        {t('RoleMgmt.noMenus', '暂无可分配的菜单')}
      </p>
    );
  } else {
    content = (
      <CheckboxTree
        tree={displayTree}
        checkedKeys={checkedKeys}
        onCheckedKeysChange={setCheckedKeys}
        defaultExpandAll={expandAll}
        checkStrictly
      />
    );
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="sm:max-w-xl flex flex-col">
        <SheetHeader className="shrink-0">
          <SheetTitle>
            {t('RoleMgmt.dialog.assignMenus', '分配菜单')}
          </SheetTitle>
          <SheetDescription>
            {t(
              'RoleMgmt.dialog.assignMenusDesc',
              '为角色「{{roleName}}」分配可访问的菜单',
              { roleName: role?.name ?? '' },
            )}
          </SheetDescription>
        </SheetHeader>

        <div className="flex items-center gap-2 shrink-0 px-4">
          <Input
            placeholder={t('RoleMgmt.searchMenus', '按目录名或菜单名搜索...')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 flex-1"
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={handleToggleExpand}
            title={
              expandAll
                ? t('RoleMgmt.collapseAll', '收起全部')
                : t('RoleMgmt.expandAll', '展开全部')
            }
          >
            <Icon
              icon={
                expandAll ? 'lucide:fold-vertical' : 'lucide:unfold-vertical'
              }
              className="size-4"
            />
          </Button>
          <Button variant="outline" size="sm" onClick={handleSelectAll}>
            {t('RoleMgmt.selectAll', '全选')}
          </Button>
          <Button variant="outline" size="sm" onClick={handleClearAll}>
            {t('RoleMgmt.clearAll', '清空')}
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto rounded-md border mx-4 p-2">
          {content}
        </div>

        <SheetFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('RoleMgmt.dialog.cancel', '取消')}
          </Button>
          <Button onClick={() => submit()} disabled={submitting}>
            {submitting
              ? t('RoleMgmt.dialog.submitting', '提交中...')
              : t('RoleMgmt.dialog.confirm', '确认')}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
};

export type { MenuAssignDialogProps };
export { MenuAssignDialog };
