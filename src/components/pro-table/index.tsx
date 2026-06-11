import { Icon } from '@iconify/react';
import type { ColumnDef, SortingState } from '@tanstack/react-table';
import { useRequest } from 'ahooks';
import type { ForwardedRef, ReactElement, RefAttributes } from 'react';
import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { DataTable } from '@/components/data-table';
import { DataTablePagination } from '@/components/data-table/pagination';
import { Button } from '@/components/ui/button';
import { DEFAULT_PAGE_SIZE } from '@/types/common';
import { SearchForm } from './search-form';
import type { ProTableColumnMeta, ProTableProps, ProTableRef } from './types';

// biome-ignore lint/style/useNamingConvention: TData/TValue are TanStack Table conventions
const ProTableImpl = <TData, TValue = unknown>(
  {
    columns,
    request,
    data: staticData,
    header,
    refreshable,
    search,
    onSearchValuesChange,
    pagination,
    initialColumnPinning,
    defaultSort,
    params: extraParams,
    getSubRows,
  }: ProTableProps<TData, TValue>,
  ref: ForwardedRef<ProTableRef>,
) => {
  const isStaticMode = staticData !== undefined;

  const showSearch = search !== false;
  const showPagination = !isStaticMode && pagination !== false;
  const searchConfig = search === false ? undefined : search;
  const paginationConfig = pagination === false ? undefined : pagination;

  const defaultPageSize =
    paginationConfig?.defaultPageSize ?? DEFAULT_PAGE_SIZE;
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(defaultPageSize);
  const [searchParams, setSearchParams] = useState<Record<string, unknown>>({});
  const [sorting, setSorting] = useState<SortingState>(() =>
    defaultSort
      ? [{ id: defaultSort.id, desc: defaultSort.desc ?? false }]
      : [],
  );

  /** Track previous searchParams to detect changes. */
  const prevSearchRef = useRef(searchParams);
  const silentRefreshingRef = useRef(false);

  const noopRequest = useCallback(async () => [] as TData[], []);

  const mergedRequest = useCallback(() => {
    if (isStaticMode) return noopRequest();
    const activeSort = sorting[0];
    const merged: { page: number; pageSize: number; [key: string]: unknown } = {
      page,
      pageSize,
      ...extraParams,
      ...searchParams,
      ...(activeSort && {
        sortBy: activeSort.id,
        sortOrder: activeSort.desc ? 'desc' : 'asc',
      }),
    };
    if (!request) return noopRequest();
    return request(merged);
  }, [
    page,
    pageSize,
    searchParams,
    extraParams,
    sorting,
    request,
    isStaticMode,
    noopRequest,
  ]);

  const {
    data: reqData,
    loading: reqLoading,
    refresh,
    mutate,
  } = useRequest(mergedRequest, {
    refreshDeps: [page, pageSize, searchParams, extraParams, sorting],
    manual: isStaticMode,
  });
  const loading = isStaticMode ? false : reqLoading;

  const silentRefresh = useCallback(async () => {
    if (isStaticMode || silentRefreshingRef.current) return;
    silentRefreshingRef.current = true;
    try {
      mutate(await mergedRequest());
    } finally {
      silentRefreshingRef.current = false;
    }
  }, [isStaticMode, mergedRequest, mutate]);

  useImperativeHandle(
    ref,
    () => ({
      refresh: (options) => {
        if (!isStaticMode) {
          if (options?.silent) {
            void silentRefresh();
            return;
          }
          refresh();
        }
      },
    }),
    [isStaticMode, refresh, silentRefresh],
  );

  const handleSearch = useCallback((values: Record<string, unknown>) => {
    prevSearchRef.current = values;
    setSearchParams(values);
    setPage(1);
  }, []);

  const handleReset = useCallback(() => {
    prevSearchRef.current = {};
    setSearchParams({});
    setPage(1);
  }, []);

  const handleSortingChange = useCallback(
    (updater: SortingState | ((prev: SortingState) => SortingState)) => {
      setSorting((prev) => {
        const next = typeof updater === 'function' ? updater(prev) : updater;
        return next.slice(0, 1);
      });
      setPage(1);
    },
    [],
  );

  const handlePageChange = useCallback((newPage: number) => {
    setPage(newPage);
  }, []);

  const handlePageSizeChange = useCallback((newSize: number) => {
    setPageSize(newSize);
    setPage(1);
  }, []);

  /** Cast to ColumnDef[] for DataTable compatibility. */
  const tableColumns = useMemo(
    () =>
      (columns as ColumnDef<TData, TValue>[]).filter(
        (c) => (c.meta as ProTableColumnMeta | undefined)?.visible !== false,
      ),
    [columns],
  );

  const items = useMemo(() => {
    if (isStaticMode && staticData) {
      if (Object.keys(searchParams).length === 0) return staticData;
      return staticData.filter((row) =>
        Object.entries(searchParams).every(([key, value]) => {
          if (value == null || value === '') return true;
          const cellValue = (row as Record<string, unknown>)[key];
          if (cellValue == null) return false;
          return String(cellValue)
            .toLowerCase()
            .includes(String(value).toLowerCase());
        }),
      );
    }
    return Array.isArray(reqData) ? reqData : (reqData?.items ?? []);
  }, [isStaticMode, staticData, searchParams, reqData]);
  const totalItems =
    isStaticMode || Array.isArray(reqData) ? 0 : (reqData?.totalItems ?? 0);

  return (
    <div className="flex h-full flex-col gap-4">
      {header && (
        <div className="flex shrink-0 items-center justify-between">
          {header.title && (
            <h1 className="text-2xl font-bold">{header.title}</h1>
          )}
          {(header.toolbar || (refreshable && !isStaticMode)) && (
            <div className="flex items-center gap-2">
              {header.toolbar}
              {refreshable && !isStaticMode && (
                <Button
                  variant="outline"
                  size="icon"
                  className="size-8"
                  onClick={refresh}
                  disabled={loading}
                >
                  <Icon icon="mdi:refresh" className="size-4" />
                </Button>
              )}
            </div>
          )}
        </div>
      )}

      {showSearch && (
        <SearchForm
          columns={columns}
          defaultCollapsed={searchConfig?.defaultCollapsed}
          searchText={searchConfig?.searchText}
          resetText={searchConfig?.resetText}
          onSearch={handleSearch}
          onReset={handleReset}
          onValuesChange={onSearchValuesChange}
        />
      )}

      <div className="min-h-0 flex-1">
        <DataTable
          columns={tableColumns}
          data={items}
          loading={loading}
          sorting={sorting}
          onSortingChange={handleSortingChange}
          initialColumnPinning={initialColumnPinning}
          getSubRows={getSubRows}
        />
      </div>

      {showPagination && (
        <DataTablePagination
          page={page}
          pageSize={pageSize}
          totalItems={totalItems}
          onPageChange={handlePageChange}
          onPageSizeChange={handlePageSizeChange}
          pageSizeOptions={paginationConfig?.pageSizeOptions}
        />
      )}
    </div>
  );
};

// biome-ignore lint/style/useNamingConvention: TData/TValue are TanStack Table conventions
const ProTable = forwardRef(ProTableImpl) as <TData, TValue = unknown>(
  props: ProTableProps<TData, TValue> & RefAttributes<ProTableRef>,
) => ReactElement;

export { buildColumns, extractFilterFields } from './build-columns';
export type {
  ColumnOption,
  ProTableColumnDef,
  ProTableColumnMeta,
  ProTableProps,
  ProTableRef,
} from './types';
export { ProTable };
