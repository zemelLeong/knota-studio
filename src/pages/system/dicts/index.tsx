import { Icon } from '@iconify/react';
import { useRequest } from 'ahooks';
import { useCallback, useMemo, useRef, useState } from 'react';
import type { ProTableColumnDef, ProTableRef } from '@/components/pro-table';
import { buildColumns, ProTable } from '@/components/pro-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { useT } from '@/i18n';
import { cn } from '@/lib/utils';
import type { DictItemTreeResponse, DictTypeResponse } from '@/types/dict';
import { toast } from '@/utils/toast';
import { useDictsAgent } from './agent';
import { DictItemDialog } from './DictItemDialog';
import { DictTypeDialog } from './DictTypeDialog';
import {
  createDictTypeTableColumns,
  getDictItemTree,
  listDictTypes,
  toggleDictItemStatus,
  toggleDictTypeStatus,
} from './options';

const scopeVariants: Record<
  string,
  { variant: 'default' | 'secondary' | 'outline' }
> = {
  system: { variant: 'default' },
  override: { variant: 'secondary' },
  tenantOnly: { variant: 'outline' },
};

// ── Dict item tree card ─────────────────────────────────────────

const DictItemCard = ({
  item,
  depth,
  onEdit,
  onToggleStatus,
}: {
  item: DictItemTreeResponse;
  depth: number;
  onEdit: (item: DictItemTreeResponse) => void;
  onToggleStatus: (item: DictItemTreeResponse) => void;
}) => {
  const [collapsed, setCollapsed] = useState(false);
  const hasChildren = item.children && item.children.length > 0;
  const isActive = item.status === 'active';
  const t = useT();

  return (
    <div style={{ paddingLeft: `${depth * 20}px` }}>
      <div
        className={cn(
          'group flex items-center gap-3 rounded-lg border px-4 py-3 transition-colors hover:bg-accent/50',
          !isActive && 'opacity-60',
        )}
      >
        {/* Expand/collapse toggle */}
        <button
          type="button"
          className={cn('shrink-0', !hasChildren && 'invisible')}
          onClick={() => setCollapsed((prev) => !prev)}
        >
          <Icon
            icon={collapsed ? 'lucide:chevron-right' : 'lucide:chevron-down'}
            className="h-4 w-4 text-muted-foreground"
          />
        </button>

        {/* Name + code */}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{item.name}</p>
          <p className="truncate text-xs text-muted-foreground">
            <code>{item.code}</code>
            {item.value && (
              <>
                <span className="mx-1.5 text-border">|</span>
                {item.value}
              </>
            )}
          </p>
        </div>

        {/* Status */}
        <Badge
          variant={isActive ? 'default' : 'destructive'}
          className="shrink-0 text-xs"
        >
          {isActive
            ? t('DictMgmt.badge.enabled', '启用')
            : t('DictMgmt.badge.disabled', '禁用')}
        </Badge>

        {/* Actions — visible on hover */}
        <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <Button variant="ghost" size="xs" onClick={() => onEdit(item)}>
            {t('DictMgmt.action.edit', '编辑')}
          </Button>
          <Button
            variant="ghost"
            size="xs"
            className={
              isActive ? 'text-destructive hover:text-destructive' : ''
            }
            onClick={() => onToggleStatus(item)}
          >
            {isActive
              ? t('DictMgmt.badge.disabled', '禁用')
              : t('DictMgmt.badge.enabled', '启用')}
          </Button>
        </div>
      </div>

      {/* Children */}
      {hasChildren && !collapsed && (
        <div className="mt-1 flex flex-col gap-1">
          {item.children.map((child) => (
            <DictItemCard
              key={child.id}
              item={child}
              depth={depth + 1}
              onEdit={onEdit}
              onToggleStatus={onToggleStatus}
            />
          ))}
        </div>
      )}
    </div>
  );
};

// ── Dict items sheet (left-side, wide) ──────────────────────────

const DictItemsSheet = ({
  dictType,
  open,
  onOpenChange,
  setCreateItemOpen,
  setEditItem,
}: {
  dictType: DictTypeResponse | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  setCreateItemOpen: (open: boolean) => void;
  setEditItem: (item: DictItemTreeResponse | null) => void;
}) => {
  const t = useT();
  const [refreshKey, setRefreshKey] = useState(0);

  const { data: items = [] } = useRequest(
    () => (dictType ? getDictItemTree(dictType.code) : Promise.resolve([])),
    {
      refreshDeps: [dictType?.code, refreshKey],
    },
  );

  const handleItemSuccess = useCallback(() => {
    setRefreshKey((prev) => prev + 1);
  }, []);

  const handleToggleItemStatus = useCallback(
    (item: DictItemTreeResponse) => {
      void toggleDictItemStatus(item.id, { version: item.version }).then(() => {
        toast.success(
          item.status === 'active'
            ? t('DictMgmt.toast.disabled', '已禁用')
            : t('DictMgmt.toast.enabled', '已启用'),
        );
        handleItemSuccess();
      });
    },
    [handleItemSuccess, t],
  );

  if (!dictType) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{dictType.name}</SheetTitle>
          <SheetDescription>
            {t('DictMgmt.dictItem', '字典项')} · {dictType.code}
          </SheetDescription>
        </SheetHeader>

        <div className="flex items-center justify-between px-4">
          <span className="text-xs text-muted-foreground">
            {items.length} {t('DictMgmt.itemCountSuffix', '项')}
          </span>
          <Button
            size="sm"
            onClick={() => {
              setCreateItemOpen(true);
            }}
          >
            <Icon icon="lucide:plus" className="mr-1 h-4 w-4" />
            {t('DictMgmt.action.createItem', '创建字典项')}
          </Button>
        </div>

        <div className="flex flex-col gap-1 px-4 pb-4">
          {items.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {t('DictMgmt.noItems', '暂无字典项')}
            </p>
          ) : (
            items.map((item) => (
              <DictItemCard
                key={item.id}
                item={item}
                depth={0}
                onEdit={setEditItem}
                onToggleStatus={handleToggleItemStatus}
              />
            ))
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
};

// ── Main page ───────────────────────────────────────────────────

const DictsPage = () => {
  const t = useT();
  useDictsAgent();

  const scopeMap = useMemo<
    Record<
      string,
      { label: string; variant: 'default' | 'secondary' | 'outline' }
    >
  >(
    () => ({
      system: {
        label: t('DictMgmt.scopeSystem', '系统'),
        variant: scopeVariants.system.variant,
      },
      override: {
        label: t('DictMgmt.scopeOverride', '覆盖'),
        variant: scopeVariants.override.variant,
      },
      tenantOnly: {
        label: t('DictMgmt.scopeTenant', '租户'),
        variant: scopeVariants.tenantOnly.variant,
      },
    }),
    [t],
  );

  const [selectedType, setSelectedType] = useState<DictTypeResponse | null>(
    null,
  );
  const [itemsSheetOpen, setItemsSheetOpen] = useState(false);

  const [createTypeOpen, setCreateTypeOpen] = useState(false);
  const [editType, setEditType] = useState<DictTypeResponse | null>(null);
  const typeTableRef = useRef<ProTableRef>(null);

  const [createItemOpen, setCreateItemOpen] = useState(false);
  const [editItem, setEditItem] = useState<DictItemTreeResponse | null>(null);

  const handleTypeSuccess = useCallback(() => {
    typeTableRef.current?.refresh();
  }, []);

  const handleItemSuccess = useCallback(() => {
    setCreateItemOpen(false);
    setEditItem(null);
  }, []);

  const handleToggleTypeStatus = useCallback(
    (dictType: DictTypeResponse) => {
      void toggleDictTypeStatus(dictType.id, {
        version: dictType.version,
      }).then(() => {
        toast.success(
          dictType.status === 'active'
            ? t('DictMgmt.toast.disabled', '已禁用')
            : t('DictMgmt.toast.enabled', '已启用'),
        );
        handleTypeSuccess();
      });
    },
    [handleTypeSuccess, t],
  );

  const typeColumns = useMemo(
    () =>
      buildColumns<DictTypeResponse>(createDictTypeTableColumns(t), {
        name: ({ row }) => (
          <button
            type="button"
            className="text-left font-medium text-primary hover:underline cursor-pointer"
            onClick={() => {
              setSelectedType(row.original);
              setItemsSheetOpen(true);
            }}
          >
            {row.original.name}
          </button>
        ),
        status: ({ row }) => {
          const isActive = row.original.status === 'active';
          return (
            <Badge variant={isActive ? 'default' : 'destructive'}>
              {isActive
                ? t('DictMgmt.badge.enabled', '启用')
                : t('DictMgmt.badge.disabled', '禁用')}
            </Badge>
          );
        },
        scope: ({ row }) => {
          const scopeInfo = scopeMap[row.original.scope];
          return scopeInfo ? (
            <Badge variant={scopeInfo.variant}>{scopeInfo.label}</Badge>
          ) : (
            <span>{row.original.scope}</span>
          );
        },
        actions: ({ row }) => {
          const dictType = row.original;
          const isActive = dictType.status === 'active';
          return (
            <div className="inline-flex items-center gap-1">
              <Button
                variant="ghost"
                size="xs"
                onClick={() => {
                  setSelectedType(dictType);
                  setItemsSheetOpen(true);
                }}
              >
                {t('DictMgmt.action.viewItems', '查看项')}
              </Button>
              <Button
                variant="ghost"
                size="xs"
                onClick={() => setEditType(dictType)}
              >
                {t('DictMgmt.action.edit', '编辑')}
              </Button>
              <Button
                variant="ghost"
                size="xs"
                className={
                  isActive ? 'text-destructive hover:text-destructive' : ''
                }
                onClick={() => handleToggleTypeStatus(dictType)}
              >
                {isActive
                  ? t('DictMgmt.badge.disabled', '禁用')
                  : t('DictMgmt.badge.enabled', '启用')}
              </Button>
            </div>
          );
        },
      }) as ProTableColumnDef<DictTypeResponse>[],
    [handleToggleTypeStatus, t, scopeMap],
  );

  return (
    <>
      <ProTable
        ref={typeTableRef}
        columns={typeColumns}
        request={(params) =>
          listDictTypes({
            page: params.page as number,
            pageSize: params.pageSize as number,
          })
        }
        header={{
          title: t('DictMgmt.title', '字典管理'),
          toolbar: (
            <Button onClick={() => setCreateTypeOpen(true)}>
              {t('DictMgmt.action.createType', '创建字典类型')}
            </Button>
          ),
        }}
        initialColumnPinning={{ left: ['name'], right: ['actions'] }}
      />

      <DictTypeDialog
        open={createTypeOpen || !!editType}
        dictType={editType}
        onOpenChange={(open) => {
          if (!open) {
            setCreateTypeOpen(false);
            setEditType(null);
          }
        }}
        onSuccess={() => {
          setCreateTypeOpen(false);
          setEditType(null);
          handleTypeSuccess();
        }}
      />

      <DictItemsSheet
        dictType={selectedType}
        open={itemsSheetOpen}
        onOpenChange={(open) => {
          if (!open) setItemsSheetOpen(false);
        }}
        setCreateItemOpen={setCreateItemOpen}
        setEditItem={setEditItem}
      />

      <DictItemDialog
        open={createItemOpen || !!editItem}
        dictItem={editItem}
        selectedTypeId={selectedType?.id ?? null}
        onOpenChange={(open) => {
          if (!open) {
            setCreateItemOpen(false);
            setEditItem(null);
          }
        }}
        onSuccess={handleItemSuccess}
      />
    </>
  );
};

export default DictsPage;
