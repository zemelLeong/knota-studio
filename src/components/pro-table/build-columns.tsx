import type { CellContext, ColumnDef } from '@tanstack/react-table';
import type { ReactNode } from 'react';

import type { FieldConfig } from '@/components/form/types';
import type { ColumnOption, ProTableColumnMeta } from './types';

/**
 * Cell renderer — receives TanStack CellContext, returns ReactNode.
 * Most renderers only destructure `{ row }` to access `row.original`.
 */
// biome-ignore lint/style/useNamingConvention: TData is a TanStack Table convention
export type CellRenderer<TData> = (
  context: CellContext<TData, unknown>,
) => ReactNode;

/**
 * Convert a `ColumnOption[]` (single source of truth) into TanStack `ColumnDef[]`.
 *
 * @param options  - Column metadata from `options.ts`
 * @param renderers - Optional map of `key → cell renderer` for columns with custom UI
 */
// biome-ignore lint/style/useNamingConvention: TData is a TanStack Table convention
export function buildColumns<TData>(
  options: ColumnOption[],
  renderers?: Record<string, CellRenderer<TData>>,
): ColumnDef<TData>[] {
  return options.map((opt) => {
    const meta: ProTableColumnMeta = {
      ellipsis: opt.ellipsis ?? true,
      showOverflowTooltip: opt.showOverflowTooltip ?? true,
      ...(opt.align && { align: opt.align }),
      ...(opt.search && { search: opt.search }),
      ...(opt.sortable !== undefined && { sortable: opt.sortable }),
      ...(opt.description && { description: opt.description }),
      ...(opt.visible !== undefined && { visible: opt.visible }),
    };

    return {
      accessorKey: opt.key,
      header: opt.label,
      enableSorting: opt.sortable === true,
      ...(opt.size != null && { size: opt.size }),
      ...(opt.minSize != null && { minSize: opt.minSize }),
      ...(opt.maxSize != null && { maxSize: opt.maxSize }),
      ...(opt.enableResizing != null && {
        enableResizing: opt.enableResizing,
      }),
      meta,
      ...(renderers?.[opt.key] && { cell: renderers[opt.key] }),
    };
  });
}

/**
 * Derive `FieldConfig[]` from columns that have a `search` config.
 * Used by the agent system to understand which fields are searchable.
 */
export const extractFilterFields = (columns: ColumnOption[]): FieldConfig[] =>
  columns
    .filter((col) => col.search)
    .map((col) => ({
      name: col.key,
      label: col.label,
      type: col.search?.type ?? 'text',
      placeholder: col.search?.placeholder,
      options: col.search?.options,
    }));
