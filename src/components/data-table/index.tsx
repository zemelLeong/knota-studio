import { Icon } from '@iconify/react';
import type {
  ColumnDef,
  ColumnMeta,
  ColumnPinningState,
  OnChangeFn,
  SortingState,
} from '@tanstack/react-table';
import {
  flexRender,
  getCoreRowModel,
  getExpandedRowModel,
  useReactTable,
} from '@tanstack/react-table';
import type { CSSProperties, ReactNode } from 'react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useT } from '@/i18n';
import { cn } from '@/lib/utils';

// biome-ignore lint/style/useNamingConvention: TData/TValue are TanStack Table conventions
interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  loading?: boolean;
  sorting?: SortingState;
  onSortingChange?: OnChangeFn<SortingState>;
  /** Default pinned columns. e.g. { left: ['name'], right: ['actions'] } */
  initialColumnPinning?: ColumnPinningState;
  /** Optional sub-row accessor for tree/hierarchical tables. */
  getSubRows?: (row: TData) => TData[] | undefined;
}

// biome-ignore lint/style/useNamingConvention: TData is a TanStack Table convention
export interface DataTableMeta<TData = unknown>
  extends ColumnMeta<TData, unknown> {
  /** Cell content alignment. Defaults to 'left'. */
  align?: 'left' | 'center' | 'right';
  /** Enable single-line ellipsis truncation. Default: false (text wraps). */
  ellipsis?: boolean;
  /** Show tooltip on hover when text is truncated. Requires ellipsis=true. Only for text cells. */
  showOverflowTooltip?: boolean;
}

const headerAlignClass = {
  left: 'text-left',
  center: 'text-center',
  right: 'text-right',
} as const;

const headerContentAlignClass = {
  left: 'justify-start',
  center: 'justify-center',
  right: 'justify-end',
} as const;

const cellAlignClass = {
  left: 'text-left',
  center: 'text-center',
  right: 'text-right',
} as const;

function getSortIcon(sorted: false | 'asc' | 'desc') {
  if (sorted === 'asc') return 'lucide:arrow-up';
  if (sorted === 'desc') return 'lucide:arrow-down';
  return 'lucide:arrow-up-down';
}

const getPinningStyles = (column: {
  getIsPinned: () => false | 'left' | 'right';
  getStart: (side: 'left') => number;
  getAfter: (side: 'right') => number;
  getSize: () => number;
}): CSSProperties => {
  const isPinned = column.getIsPinned();
  if (!isPinned) {
    return { width: column.getSize() };
  }
  return {
    position: 'sticky',
    left: isPinned === 'left' ? column.getStart('left') : undefined,
    right: isPinned === 'right' ? column.getAfter('right') : undefined,
    width: column.getSize(),
    zIndex: 1,
  };
};

/** Gradient overlay for pinned column visual separation. */
const PinGradient = ({
  side,
  visible,
}: {
  side: 'left' | 'right';
  visible: boolean;
}) => {
  if (!visible) return null;
  return (
    <div
      className={cn(
        'pointer-events-none absolute top-0 h-full w-2',
        side === 'left'
          ? 'right-0 translate-x-full bg-gradient-to-r from-black/10 to-transparent'
          : 'left-0 -translate-x-full bg-gradient-to-l from-black/10 to-transparent',
      )}
    />
  );
};

/** Wraps text content with overflow-detecting tooltip. */
const OverflowCell = ({
  children,
  enableTooltip,
}: {
  children: ReactNode;
  enableTooltip: boolean;
}) => {
  const spanRef = useRef<HTMLSpanElement>(null);
  const [isOverflowing, setIsOverflowing] = useState(false);

  const measure = useCallback(() => {
    const el = spanRef.current;
    if (el) {
      setIsOverflowing(el.scrollWidth > el.clientWidth);
    }
  }, []);

  if (!enableTooltip) {
    return <span className="block truncate">{children}</span>;
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          {/* biome-ignore lint/a11y/noStaticElementInteractions: tooltip trigger */}
          <span ref={spanRef} className="block truncate" onMouseEnter={measure}>
            {children}
          </span>
        </TooltipTrigger>
        {isOverflowing && (
          <TooltipContent className="max-h-[30vh] overflow-y-auto">
            <div className="max-w-80 whitespace-pre-wrap break-words">
              {children}
            </div>
          </TooltipContent>
        )}
      </Tooltip>
    </TooltipProvider>
  );
};

// biome-ignore lint/style/useNamingConvention: TData/TValue are TanStack Table conventions
function DataTableImpl<TData, TValue>({
  columns,
  data,
  loading,
  sorting,
  onSortingChange,
  initialColumnPinning,
  getSubRows,
}: DataTableProps<TData, TValue>) {
  const t = useT();
  const table = useReactTable({
    data,
    columns,
    enableColumnResizing: true,
    columnResizeMode: 'onChange',
    manualSorting: true,
    state: sorting ? { sorting } : undefined,
    onSortingChange,
    getCoreRowModel: getCoreRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
    getSubRows,
    initialState: {
      columnPinning: initialColumnPinning ?? {},
    },
  });

  const scrollRef = useRef<HTMLDivElement>(null);
  const [showLeftPin, setShowLeftPin] = useState(false);
  const [showRightPin, setShowRightPin] = useState(false);

  const checkScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const hasScroll = el.scrollWidth > el.clientWidth + 1;
    if (!hasScroll) {
      setShowLeftPin(false);
      setShowRightPin(false);
      return;
    }
    setShowLeftPin(el.scrollLeft > 0);
    setShowRightPin(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  }, []);

  useEffect(() => {
    checkScroll();
  }, [checkScroll]);

  return (
    <div className="relative flex h-full flex-col rounded-md border">
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-auto"
        onScroll={checkScroll}
      >
        <table
          className="data-table w-full table-fixed caption-bottom text-sm"
          style={{
            minWidth: table.getTotalSize(),
          }}
        >
          <thead>
            {table.getHeaderGroups().map((headerGroup) => (
              <tr
                key={headerGroup.id}
                className="transition-colors hover:bg-muted/50"
              >
                {headerGroup.headers.map((header) => {
                  const isPinned = header.column.getIsPinned();
                  const meta = header.column.columnDef.meta as
                    | DataTableMeta
                    | undefined;
                  const align = meta?.align ?? 'left';
                  const canSort = header.column.getCanSort();
                  const sorted = header.column.getIsSorted();

                  return (
                    <th
                      key={header.id}
                      className={cn(
                        'sticky top-0 h-10 px-2 align-middle font-medium whitespace-nowrap text-foreground bg-muted',
                        headerAlignClass[align],
                        canSort && 'cursor-pointer select-none',
                        isPinned
                          ? 'data-table-cell-pinned overflow-visible'
                          : 'overflow-hidden text-ellipsis',
                      )}
                      style={getPinningStyles(header.column)}
                      onClick={
                        canSort
                          ? header.column.getToggleSortingHandler()
                          : undefined
                      }
                    >
                      {header.isPlaceholder ? null : (
                        <span
                          className={cn(
                            'flex min-w-0 items-center gap-1 truncate',
                            headerContentAlignClass[align],
                          )}
                        >
                          <span className="truncate">
                            {flexRender(
                              header.column.columnDef.header,
                              header.getContext(),
                            )}
                          </span>
                          {canSort && (
                            <Icon
                              icon={getSortIcon(sorted)}
                              className="size-3 shrink-0 text-muted-foreground"
                            />
                          )}
                        </span>
                      )}
                      {header.column.getCanResize() && (
                        // biome-ignore lint/a11y/noStaticElementInteractions: column resize handle
                        <div
                          onDoubleClick={() => header.column.resetSize()}
                          onMouseDown={header.getResizeHandler()}
                          onTouchStart={header.getResizeHandler()}
                          className={cn(
                            'absolute right-0 top-0 h-full w-1 cursor-col-resize select-none touch-none',
                            'hover:bg-primary/20',
                            header.column.getIsResizing() && 'bg-primary/30',
                          )}
                        />
                      )}
                      {isPinned && (
                        <PinGradient
                          side={isPinned}
                          visible={
                            isPinned === 'left' ? showLeftPin : showRightPin
                          }
                        />
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="h-24 p-2 text-center align-middle"
                >
                  {t('Common.noData', '暂无数据')}
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row) => (
                <tr
                  key={row.id}
                  className="transition-colors hover:bg-muted/50"
                >
                  {row.getVisibleCells().map((cell, cellIndex) => {
                    const isPinned = cell.column.getIsPinned();
                    const meta = cell.column.columnDef.meta as
                      | DataTableMeta
                      | undefined;
                    const align = meta?.align ?? 'left';
                    const ellipsis = meta?.ellipsis ?? false;
                    const showTooltip =
                      ellipsis && (meta?.showOverflowTooltip ?? false);
                    const isFirstCell = cellIndex === 0;
                    const whitespaceClass = ellipsis
                      ? cn(
                          'whitespace-nowrap',
                          isPinned ? 'overflow-visible' : 'overflow-hidden',
                        )
                      : 'whitespace-normal';
                    const cellContent = ellipsis ? (
                      <OverflowCell enableTooltip={showTooltip}>
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext(),
                        )}
                      </OverflowCell>
                    ) : (
                      flexRender(cell.column.columnDef.cell, cell.getContext())
                    );

                    return (
                      <td
                        key={cell.id}
                        className={cn(
                          'p-2 align-middle',
                          cellAlignClass[align],
                          isPinned ? 'data-table-cell-pinned' : '',
                          whitespaceClass,
                        )}
                        style={{
                          ...getPinningStyles(cell.column),
                        }}
                      >
                        {isFirstCell ? (
                          <div
                            className="flex items-center gap-1"
                            style={
                              row.depth > 0
                                ? { paddingLeft: row.depth * 20 }
                                : undefined
                            }
                          >
                            {row.getCanExpand() && (
                              <button
                                type="button"
                                className="inline-flex shrink-0 cursor-pointer items-center justify-center"
                                style={{ width: 20, height: 20 }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  row.toggleExpanded();
                                }}
                              >
                                <Icon
                                  icon="lucide:chevron-right"
                                  className={cn(
                                    'h-4 w-4 transition-transform duration-200',
                                    row.getIsExpanded() && 'rotate-90',
                                  )}
                                />
                              </button>
                            )}
                            <span className="min-w-0 flex-1">
                              {cellContent}
                            </span>
                          </div>
                        ) : (
                          cellContent
                        )}
                        {isPinned && (
                          <PinGradient
                            side={isPinned}
                            visible={
                              isPinned === 'left' ? showLeftPin : showRightPin
                            }
                          />
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {loading && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/60 backdrop-blur-[2px]">
          <span className="text-sm text-muted-foreground">
            {t('Common.loading', '加载中...')}
          </span>
        </div>
      )}
    </div>
  );
}

export type { DataTableProps };

const DataTable = memo(DataTableImpl) as typeof DataTableImpl;

export { DataTable };
