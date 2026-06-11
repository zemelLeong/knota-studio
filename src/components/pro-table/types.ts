import type { ColumnDef, ColumnPinningState } from '@tanstack/react-table';
import type { ReactNode } from 'react';
import type { DataTableMeta } from '@/components/data-table';
import type {
  FieldType,
  RemoteOptionSource,
  SelectOption,
} from '@/components/form/types';
import type { PaginatedResponse } from '@/types/common';

/**
 * Lightweight filter/search config for column meta.
 * Reuses FieldType from lib/form so search, agent, and dialog forms speak the same language.
 */
export interface ColumnFilterConfig {
  /** Input type. Defaults to 'text'. */
  type?: FieldType;
  /** Placeholder text. */
  placeholder?: string;
  /** Options for select/multiselect types. */
  options?: SelectOption[];
  /** Remote data source for remote-select type. */
  remote?: RemoteOptionSource;
  /** Field ordering in search form (lower = higher priority). */
  order?: number;
  /** Initial value. */
  initialValue?: unknown;
  /** Transform search value before sending to API (e.g. dateRange → startDate + endDate). */
  transform?: (value: unknown) => Record<string, unknown>;
  /** For dateRange type: show time picker. Default: true. */
  showTime?: boolean;
  /** For dateRange type: show seconds picker. Default: false. */
  showSeconds?: boolean;
}

/** ProTable column meta — extends DataTableMeta with search fields. */
export interface ProTableColumnMeta extends DataTableMeta {
  /** Search/filter config. Present = field appears in search form. */
  search?: ColumnFilterConfig;
  /** Whether this column is sortable. Default: false. */
  sortable?: boolean;
  /** Human-readable description. */
  description?: string;
  /** Whether column is visible in the table. Used for search-only columns. */
  visible?: boolean;
}

/** ProTable column definition — ColumnDef with ProTableColumnMeta. */
// biome-ignore lint/style/useNamingConvention: TData/TValue are TanStack Table conventions
export type ProTableColumnDef<TData, TValue = unknown> = ColumnDef<
  TData,
  TValue
> & {
  meta?: ProTableColumnMeta;
  id?: string;
  header?:
    | string
    | ((props: {
        column: { columnDef: ProTableColumnDef<TData, TValue> };
      }) => ReactNode);
};

// biome-ignore lint/style/useNamingConvention: TData/TValue are TanStack Table conventions
export interface ProTableProps<TData, TValue = unknown> {
  /** Column definitions with optional search config in meta. */
  columns: ProTableColumnDef<TData, TValue>[];
  /**
   * Data fetching function. Receives merged params (page, pageSize, search values, extra params).
   * One of `request` or `data` must be provided.
   */
  request?: (params: {
    page: number;
    pageSize: number;
    [key: string]: unknown;
  }) => Promise<PaginatedResponse<TData> | TData[]>;
  /**
   * Pre-loaded data array. When provided, ProTable skips internal useRequest
   * and renders the data directly (no loading state, no pagination, no search).
   * One of `request` or `data` must be provided.
   */
  data?: TData[];
  /** Header area. */
  header?: {
    title?: ReactNode;
    toolbar?: ReactNode;
  };
  /** Show a refresh button in the header toolbar area (rightmost). Only works with `request` mode. */
  refreshable?: boolean;
  /** Search form config. false to hide. */
  search?:
    | false
    | {
        defaultCollapsed?: boolean;
        searchText?: string;
        resetText?: string;
      };
  /** Observe raw search form value changes before submit. */
  onSearchValuesChange?: (values: Record<string, unknown>) => void;
  /** Pagination config. false to hide. */
  pagination?:
    | false
    | {
        defaultPageSize?: number;
        pageSizeOptions?: number[];
      };
  /** Default column pinning. */
  initialColumnPinning?: ColumnPinningState;
  /** Initial remote sorting state. */
  defaultSort?: {
    id: string;
    desc?: boolean;
  };
  /** Extra params merged into every request. */
  params?: Record<string, unknown>;
  /** Optional sub-row accessor for tree/hierarchical tables. */
  getSubRows?: (row: TData) => TData[] | undefined;
}

export interface ProTableRefreshOptions {
  /** Refresh data without showing table loading state. */
  silent?: boolean;
}

export interface ProTableRef {
  /** Refresh table data with current page, page size, search params, and extra params. */
  refresh: (options?: ProTableRefreshOptions) => void;
}

/**
 * Unified column option — single source of truth for ProTable columns.
 * Used by `buildColumns()` to generate TanStack ColumnDef[], and by the
 * agent system to understand page capabilities.
 */
export interface ColumnOption {
  /** Column key — maps to accessorKey in TanStack Table */
  key: string;
  /** Column header label */
  label: string;
  /** Column width in px */
  size?: number;
  /** Minimum column width */
  minSize?: number;
  /** Maximum column width */
  maxSize?: number;
  /** Whether column can be resized. Default: true */
  enableResizing?: boolean;
  /** Cell alignment */
  align?: 'left' | 'center' | 'right';
  /** Search/filter config — present = field appears in search form */
  search?: ColumnFilterConfig;
  /** Whether to enable text ellipsis. Default: true */
  ellipsis?: boolean;
  /** Whether to show overflow tooltip. Default: true */
  showOverflowTooltip?: boolean;
  /** Whether this column is sortable (agent metadata) */
  sortable?: boolean;
  /** Whether this column is filterable (agent metadata, derived from search) */
  filterable?: boolean;
  /** Human-readable description (agent metadata) */
  description?: string;
  /** Whether column is visible in the table. Default: true. false = search-only */
  visible?: boolean;
}

export type { ColumnPinningState };
