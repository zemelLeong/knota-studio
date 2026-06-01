/**
 * Vertical-expand i18n translation editor (shadcn / Tailwind).
 *
 * Migrated from knota-fold-admin's AntD-based TranslationKeyTable.
 *
 * Layout (server-paginated):
 *   ▶ Auth.Scope.action.batchClear   zh-CN 简体中文   批量清理      ← collapsed
 *   ▼ Auth.Scope.action.batchClear                                   ← expanded
 *       ┌──────────────┬──────────┬─────────────────────────────┐
 *       │ zh-CN        │ 简体中文  │ [Textarea: 批量清理]        │
 *       │ en-US        │ English  │ [Textarea: Batch Clear]     │
 *       │ ja-JP        │ 日本語    │ [Textarea: ]                │
 *       └──────────────┴──────────┴─────────────────────────────┘
 *
 * Key design choices:
 * - **One row = one `(namespace, key)`**. Backend bundles all locales in
 *   `byLocale` so we don't issue N requests per page.
 * - **Server-side pagination + search + namespace filter**.
 * - **Collapsed cell** shows the user-chosen "preview locale".
 * - **Expand-locales selector** lets the user limit which locales render
 *   inside the expanded sub-table.
 * - **Edits buffer** into a `Map<"ns|key|locale", value>`; sticky bar shows
 *   the count and flushes through the host page's `onCommit`.
 */

import { Icon } from '@iconify/react';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import {
  Fragment,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useT } from '@/i18n';
import { cn } from '@/lib/utils';
import type { PaginatedResponse } from '@/types/common';
import { toast } from '@/utils/toast';
import type {
  EntryLocation,
  ImportEntry,
  ImportResponse,
  KeyEntry,
  KeyListParams,
  LocaleAdmin,
  NamespaceSummary,
} from './options';
import { listEntryLocations } from './options';

dayjs.extend(relativeTime);

// ── Helpers ────────────────────────────────────────────────────────────────────

const dirtyKeyOf = (ns: string, key: string, locale: string) =>
  `${ns}|${key}|${locale}`;

const defaultPageSize = 50;

// ── Entry locations sub-table ──────────────────────────────────────────────────

function EntryLocationsRow({
  entryId,
  locations,
  loading,
  onLoad,
}: {
  entryId: string;
  locations: EntryLocation[];
  loading: boolean;
  onLoad: (id: string) => void;
}) {
  const t = useT();
  const [triggered, setTriggered] = useState(false);

  useEffect(() => {
    if (!triggered) {
      setTriggered(true);
      onLoad(entryId);
    }
  }, [entryId, onLoad, triggered]);

  if (loading) {
    return (
      <div className="py-2 text-sm text-muted-foreground">
        {t('Common.loading', '加载中...')}
      </div>
    );
  }

  if (locations.length === 0) {
    return (
      <div className="py-2 text-sm text-muted-foreground">
        {t('I18n.KeyTable.locations.empty', '无位置记录')}
      </div>
    );
  }

  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-muted-foreground">
          <th className="px-2 py-1 text-left font-medium">
            {t('I18n.KeyTable.locations.filePath', '文件路径')}
          </th>
          <th className="w-20 px-2 py-1 text-left font-medium">
            {t('I18n.KeyTable.locations.line', '行号')}
          </th>
        </tr>
      </thead>
      <tbody>
        {locations.map((loc) => (
          <tr key={loc.id} className="border-t">
            <td className="px-2 py-1 font-mono">{loc.filePath}</td>
            <td className="px-2 py-1">{loc.line}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ── LocaleEditor (memo) ────────────────────────────────────────────────────────

/**
 * Self-contained Textarea cell.
 *
 * Holds its own draft value in local state so keystrokes never re-render the
 * parent table. Only on blur do we propagate the final value upward via
 * `onCommit` — that's when the parent's dirty Map mutates and the sticky
 * bar's count refreshes.
 */
interface LocaleEditorProps {
  initialValue: string;
  initiallyDirty: boolean;
  placeholder: string;
  inherited?: boolean;
  onCommit: (next: string) => void;
}

const LocaleEditor = memo(function LocaleEditor({
  initialValue,
  initiallyDirty,
  placeholder,
  inherited = false,
  onCommit,
}: LocaleEditorProps) {
  const [value, setValue] = useState(initialValue);
  const [dirty, setDirty] = useState(initiallyDirty);
  const textRef = useRef<HTMLTextAreaElement>(null);

  // Reset when the underlying row data changes (page change, save refresh, …).
  // biome-ignore lint/correctness/useExhaustiveDependencies: only sync on initialValue change
  useEffect(() => {
    setValue(initialValue);
    setDirty(initiallyDirty);
  }, [initialValue]);

  // Auto-resize textarea to fit content (1–6 rows).
  // biome-ignore lint/correctness/useExhaustiveDependencies: must resize when value changes
  useEffect(() => {
    const el = textRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = `${Math.min(el.scrollHeight, 144)}px`;
    }
  }, [value]);

  // Mute the text until the user starts editing or has staged a change.
  const muted = inherited && !dirty;

  return (
    <textarea
      ref={textRef}
      value={value}
      rows={1}
      className={cn(
        'min-h-[32px] max-h-[144px] w-full resize-none overflow-hidden rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs outline-none',
        'border-input',
        'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
        'placeholder:text-muted-foreground',
        dirty && 'border-yellow-500 ring-1 ring-yellow-500/30',
        muted && 'text-muted-foreground',
      )}
      placeholder={placeholder}
      onChange={(e) => {
        const next = e.target.value;
        setValue(next);
        setDirty(next !== initialValue);
      }}
      onBlur={() => {
        onCommit(value);
      }}
    />
  );
});

// ── Props ──────────────────────────────────────────────────────────────────────

export interface TranslationKeyTableProps {
  /** Active locales — used both to pick preview locale and to render expanded sub-rows. */
  locales: LocaleAdmin[];
  /** Server-side paged key listing. */
  loadKeys: (params: KeyListParams) => Promise<PaginatedResponse<KeyEntry>>;
  /** Namespace filter dropdown source. */
  loadNamespaces: () => Promise<NamespaceSummary[]>;
  /** Persist a batch of dirty entries. */
  onCommit: (entries: ImportEntry[]) => Promise<ImportResponse>;
  /**
   * Tenant-only: reset a single cell to the inherited global value by
   * deleting the override row server-side.
   */
  onResetCell?: (params: {
    namespace: string;
    key: string;
    locale: string;
  }) => Promise<void>;
  /** When true, show entry metadata (status, description, lastSeenAt, locations). */
  showEntryMeta?: boolean;
  /** Slot for page-specific toolbar buttons. */
  toolbarExtra?: React.ReactNode;
  /** Optional caption above the table. */
  title?: React.ReactNode;
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function TranslationKeyTable({
  locales,
  loadKeys,
  loadNamespaces,
  onCommit,
  onResetCell,
  showEntryMeta,
  toolbarExtra,
  title,
}: TranslationKeyTableProps) {
  const t = useT();
  // Stash t in a ref so async loaders remain referentially stable.
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);

  // ── Locale derivations ──────────────────────────────────────────────────

  const enabledLocales = useMemo(
    () =>
      [...locales]
        .filter((l) => l.isEnabled)
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [locales],
  );

  const defaultLocale = useMemo(
    () => enabledLocales[0]?.locale ?? '',
    [enabledLocales],
  );

  // ── Filters & pagination state ──────────────────────────────────────────

  const [namespace, setNamespace] = useState('');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [emptyLocale, setEmptyLocale] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(defaultPageSize);

  const [previewLocale, setPreviewLocale] = useState('');
  const [visibleLocales, setVisibleLocales] = useState<string[]>([]);

  useEffect(() => {
    if (!previewLocale && defaultLocale) setPreviewLocale(defaultLocale);
  }, [defaultLocale, previewLocale]);

  useEffect(() => {
    if (visibleLocales.length === 0 && enabledLocales.length > 0) {
      setVisibleLocales(enabledLocales.map((l) => l.locale));
    }
  }, [enabledLocales, visibleLocales.length]);

  // ── Data state ──────────────────────────────────────────────────────────

  const [namespaces, setNamespaces] = useState<NamespaceSummary[]>([]);
  const [items, setItems] = useState<KeyEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [expandedRowKeys, setExpandedRowKeys] = useState<string[]>([]);
  const [entryLocations, setEntryLocations] = useState<
    Record<string, EntryLocation[]>
  >({});
  const [loadingLocations, setLoadingLocations] = useState<
    Record<string, boolean>
  >({});

  const dirtyRef = useRef<Map<string, string>>(new Map());
  const [dirtyCount, setDirtyCount] = useState(0);
  const [saving, setSaving] = useState(false);

  // ── Loaders ─────────────────────────────────────────────────────────────

  const refreshNamespaces = useCallback(() => {
    return loadNamespaces().then((list) => {
      setNamespaces(list);
    });
  }, [loadNamespaces]);

  const refreshKeys = useCallback(() => {
    setLoading(true);
    return loadKeys({
      namespace: namespace || undefined,
      q: search || undefined,
      emptyLocale: emptyLocale || undefined,
      page,
      pageSize,
    })
      .then((resp) => {
        setItems(resp.items);
        setTotal(resp.totalItems);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [loadKeys, namespace, emptyLocale, page, pageSize, search]);

  useEffect(() => {
    refreshNamespaces();
  }, [refreshNamespaces]);

  useEffect(() => {
    refreshKeys();
  }, [refreshKeys]);

  // ── Editing ─────────────────────────────────────────────────────────────

  const setCellValue = useCallback(
    (
      ns: string,
      key: string,
      locale: string,
      original: string,
      next: string,
    ) => {
      const dKey = dirtyKeyOf(ns, key, locale);
      const m = dirtyRef.current;
      const wasDirty = m.has(dKey);
      if (next === original) {
        if (wasDirty) {
          m.delete(dKey);
          setDirtyCount(m.size);
        }
      } else {
        m.set(dKey, next);
        if (!wasDirty) setDirtyCount(m.size);
      }
    },
    [],
  );

  const discardAll = useCallback(() => {
    dirtyRef.current = new Map();
    setDirtyCount(0);
  }, []);

  const flushAll = useCallback(() => {
    const m = dirtyRef.current;
    if (m.size === 0) return;
    const entries: ImportEntry[] = Array.from(m.entries())
      .map(([dKey, val]) => {
        const parts = dKey.split('|');
        return {
          namespace: parts[0],
          key: parts[1],
          locale: parts[2],
          value: val,
        };
      })
      .filter((e) => e.namespace && e.key && e.locale);
    setSaving(true);
    onCommit(entries)
      .then((resp) => {
        toast.success(
          tRef.current(
            'I18n.KeyTable.toast.saveSuccess',
            '已保存：新增 {{inserted}}，更新 {{updated}}，跳过 {{skipped}}',
            {
              inserted: resp.inserted,
              updated: resp.updated,
              skipped: resp.skipped,
            },
          ),
        );
        dirtyRef.current = new Map();
        setDirtyCount(0);
        return Promise.all([refreshKeys(), refreshNamespaces()]);
      })
      .finally(() => {
        setSaving(false);
      });
  }, [onCommit, refreshKeys, refreshNamespaces]);

  // ── Expand / collapse ───────────────────────────────────────────────────

  const toggleExpand = useCallback((stableId: string) => {
    setExpandedRowKeys((prev) =>
      prev.includes(stableId)
        ? prev.filter((id) => id !== stableId)
        : [...prev, stableId],
    );
  }, []);

  // ── Entry locations loader ──────────────────────────────────────────────

  const entryLocationsRef = useRef(entryLocations);
  entryLocationsRef.current = entryLocations;

  const loadLocations = useCallback((id: string) => {
    if (entryLocationsRef.current[id]) return;
    setLoadingLocations((p) => ({ ...p, [id]: true }));
    listEntryLocations(id)
      .then((locs) => {
        setEntryLocations((p) => ({ ...p, [id]: locs }));
      })
      .catch(() => {
        /* ignore */
      })
      .finally(() => {
        setLoadingLocations((p) => ({ ...p, [id]: false }));
      });
  }, []);

  // ── Derived values ──────────────────────────────────────────────────────

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(total / pageSize)),
    [total, pageSize],
  );

  const colSpan = 3 + (showEntryMeta ? 3 : 0);

  const cellPlaceholder = useMemo(
    () => t('I18n.KeyTable.cell.placeholder', '未翻译'),
    [t],
  );

  const localesToRender = useMemo(
    () => enabledLocales.filter((l) => visibleLocales.includes(l.locale)),
    [enabledLocales, visibleLocales],
  );

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full flex-col gap-3">
      {/* Title bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h5 className="text-base font-semibold">
          {title ?? t('I18n.KeyTable.title', '翻译管理')}
        </h5>
        <div className="flex items-center gap-2">
          {/* Visible locales — UI config, not a query filter */}
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="min-w-[200px] justify-start gap-1.5"
              >
                <Icon icon="lucide:languages" className="size-4" />
                {t('I18n.KeyTable.filter.visibleLocales', '展开时显示的语言')}
                <Badge variant="secondary" className="ml-1">
                  {visibleLocales.length}/{enabledLocales.length}
                </Badge>
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-64 p-2" align="end">
              <div className="space-y-0.5">
                {enabledLocales.map((loc) => (
                  <div
                    key={loc.locale}
                    className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 hover:bg-accent"
                  >
                    <Checkbox
                      checked={visibleLocales.includes(loc.locale)}
                      onCheckedChange={(checked) => {
                        setVisibleLocales((prev) =>
                          checked
                            ? [...prev, loc.locale]
                            : prev.filter((l) => l !== loc.locale),
                        );
                      }}
                    />
                    <span className="text-sm">
                      {loc.locale} {loc.label}
                    </span>
                  </div>
                ))}
              </div>
            </PopoverContent>
          </Popover>

          {toolbarExtra}

          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              refreshKeys();
              refreshNamespaces();
            }}
            disabled={loading}
          >
            <Icon
              icon="lucide:refresh-cw"
              className={cn('size-4', loading && 'animate-spin')}
            />
            {t('Common.refresh', '刷新')}
          </Button>
        </div>
      </div>

      {/* No enabled locales warning */}
      {enabledLocales.length === 0 && (
        <div className="flex items-center gap-2 rounded-md border border-yellow-500/50 bg-yellow-50 px-4 py-3 text-sm text-yellow-800 dark:bg-yellow-950/30 dark:text-yellow-200">
          <Icon icon="lucide:alert-triangle" className="size-4 shrink-0" />
          {t(
            'I18n.KeyTable.warn.noEnabledLocales',
            '未启用任何语言，请先到"语言管理"启用',
          )}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Namespace */}
        <Select
          value={namespace}
          onValueChange={(v) => {
            setNamespace(v);
            setPage(1);
          }}
        >
          <SelectTrigger
            className="w-60"
            onClear={() => {
              setNamespace('');
              setPage(1);
            }}
          >
            <SelectValue
              placeholder={t('I18n.KeyTable.filter.namespace', '命名空间')}
            />
          </SelectTrigger>
          <SelectContent>
            {namespaces.map((n) => (
              <SelectItem key={n.namespace} value={n.namespace}>
                {n.namespace}（{n.keyCount}）
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Search */}
        <div className="relative w-70">
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                setSearch(searchInput);
                setPage(1);
              }
            }}
            placeholder={t(
              'I18n.KeyTable.filter.search',
              '搜索 key 或翻译内容',
            )}
            className="pr-14"
          />
          <div className="absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
            {searchInput && (
              <button
                type="button"
                className="flex size-6 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground"
                onClick={() => {
                  setSearchInput('');
                  setSearch('');
                  setPage(1);
                }}
              >
                <Icon icon="lucide:x" className="size-3.5" />
              </button>
            )}
            <button
              type="button"
              className="flex size-6 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground"
              onClick={() => {
                setSearch(searchInput);
                setPage(1);
              }}
            >
              <Icon icon="lucide:search" className="size-3.5" />
            </button>
          </div>
        </div>

        {/* Preview locale */}
        <Select
          value={previewLocale}
          onValueChange={(v) => setPreviewLocale(v)}
        >
          <SelectTrigger className="w-48">
            <SelectValue
              placeholder={t('I18n.KeyTable.filter.previewLocale', '预览语言')}
            />
          </SelectTrigger>
          <SelectContent>
            {enabledLocales.map((l) => (
              <SelectItem key={l.locale} value={l.locale}>
                {l.locale} {l.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Empty locale filter */}
        <Select
          value={emptyLocale}
          onValueChange={(v) => {
            setEmptyLocale(v);
            setPage(1);
          }}
        >
          <SelectTrigger
            className="w-48"
            onClear={() => {
              setEmptyLocale('');
              setPage(1);
            }}
          >
            <SelectValue
              placeholder={t(
                'I18n.KeyTable.filter.emptyLocale',
                '缺少翻译的语言',
              )}
            />
          </SelectTrigger>
          <SelectContent>
            {enabledLocales.map((l) => (
              <SelectItem key={l.locale} value={l.locale}>
                {l.locale} {l.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <div className="relative min-h-0 flex-1 rounded-md border">
        <div className="h-full overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted">
                <th className="sticky top-0 z-[1] w-10 bg-muted px-2 py-2" />
                <th
                  className="sticky top-0 z-[1] bg-muted px-2 py-2 text-left font-medium whitespace-nowrap"
                  style={{ width: '40%' }}
                >
                  {t('I18n.KeyTable.column.key', '命名空间.键')}
                </th>
                <th className="sticky top-0 z-[1] bg-muted px-2 py-2 text-left font-medium whitespace-nowrap">
                  <div className="flex items-center gap-1">
                    <span>{t('I18n.KeyTable.column.preview', '预览')}</span>
                    <Badge variant="secondary" className="text-xs">
                      {previewLocale || '—'}
                    </Badge>
                  </div>
                </th>
                {showEntryMeta && (
                  <>
                    <th className="sticky top-0 z-[1] bg-muted w-24 px-2 py-2 text-left font-medium whitespace-nowrap">
                      {t('I18n.KeyTable.column.status', '状态')}
                    </th>
                    <th className="sticky top-0 z-[1] bg-muted w-48 px-2 py-2 text-left font-medium whitespace-nowrap">
                      {t('I18n.KeyTable.column.description', '描述')}
                    </th>
                    <th className="sticky top-0 z-[1] bg-muted w-32 px-2 py-2 text-left font-medium whitespace-nowrap">
                      {t('I18n.KeyTable.column.lastSeenAt', '最后出现')}
                    </th>
                  </>
                )}
              </tr>
            </thead>

            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td
                    colSpan={colSpan}
                    className="h-24 px-2 py-2 text-center text-muted-foreground"
                  >
                    {t('I18n.KeyTable.empty.noKeys', '暂无翻译数据')}
                  </td>
                </tr>
              ) : (
                items.map((record) => {
                  const isExpanded = expandedRowKeys.includes(record.stableId);

                  return (
                    <Fragment key={record.stableId}>
                      {/* ── Collapsed row ────────────────────────── */}
                      <tr
                        className={cn(
                          'cursor-pointer border-b transition-colors hover:bg-muted/50',
                          isExpanded && 'bg-muted/30',
                        )}
                        onClick={() => toggleExpand(record.stableId)}
                      >
                        {/* Expand arrow */}
                        <td className="w-10 px-2 py-2 text-center">
                          <Icon
                            icon="lucide:chevron-right"
                            className={cn(
                              'inline-block size-4 transition-transform duration-200',
                              isExpanded && 'rotate-90',
                            )}
                          />
                        </td>

                        {/* stableId */}
                        <td className="px-2 py-2">
                          <span className="break-all font-mono text-xs">
                            {record.stableId}
                          </span>
                        </td>

                        {/* Preview value */}
                        <td className="px-2 py-2">
                          {!previewLocale ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            (() => {
                              const cell = record.byLocale[previewLocale];
                              const original = cell?.value ?? '';
                              const dKey = dirtyKeyOf(
                                record.namespace,
                                record.key,
                                previewLocale,
                              );
                              const draft = dirtyRef.current.get(dKey);
                              const displayValue =
                                draft !== undefined ? draft : original;
                              if (!displayValue) {
                                return (
                                  <span className="italic text-muted-foreground">
                                    {t(
                                      'I18n.KeyTable.cell.untranslated',
                                      '（未翻译）',
                                    )}
                                  </span>
                                );
                              }
                              return <span>{displayValue}</span>;
                            })()
                          )}
                        </td>

                        {/* Entry meta columns */}
                        {showEntryMeta && (
                          <>
                            <td className="w-24 px-2 py-2">
                              {record.entryStatus && (
                                <Badge
                                  variant="outline"
                                  className={cn(
                                    'text-xs',
                                    record.entryStatus === 'active'
                                      ? 'border-green-500/50 bg-green-50 text-green-700 dark:bg-green-950/30 dark:text-green-300'
                                      : 'border-orange-500/50 bg-orange-50 text-orange-700 dark:bg-orange-950/30 dark:text-orange-300',
                                  )}
                                >
                                  {record.entryStatus === 'active'
                                    ? t('I18n.Entries.status.active', '活跃')
                                    : t('I18n.Entries.status.stale', '过期')}
                                </Badge>
                              )}
                            </td>
                            <td className="max-w-[200px] truncate px-2 py-2">
                              {record.entryId &&
                                (record.entryDescription ? (
                                  <span className="text-muted-foreground">
                                    {record.entryDescription}
                                  </span>
                                ) : (
                                  <span className="italic text-muted-foreground">
                                    {t(
                                      'I18n.KeyTable.cell.noDescription',
                                      '无描述',
                                    )}
                                  </span>
                                ))}
                            </td>
                            <td className="w-32 px-2 py-2">
                              {record.entryLastSeenAt && (
                                <span className="text-muted-foreground">
                                  {dayjs(record.entryLastSeenAt).fromNow()}
                                </span>
                              )}
                            </td>
                          </>
                        )}
                      </tr>

                      {/* ── Expanded row ────────────────────────── */}
                      {isExpanded && (
                        <tr className="border-b bg-muted/30">
                          <td colSpan={colSpan} className="p-0">
                            <div className="px-8 py-3 pl-12">
                              {localesToRender.length === 0 ? (
                                <div className="py-4 text-center text-sm text-muted-foreground">
                                  {t(
                                    'I18n.KeyTable.empty.noVisibleLocales',
                                    '请至少选择一种展开语言',
                                  )}
                                </div>
                              ) : (
                                localesToRender.map((loc) => {
                                  const cell = record.byLocale[loc.locale];
                                  const original = cell?.value ?? '';
                                  const isInherited =
                                    !cell || cell.isOverride === false;
                                  const dKey = dirtyKeyOf(
                                    record.namespace,
                                    record.key,
                                    loc.locale,
                                  );
                                  const draft = dirtyRef.current.get(dKey);
                                  const editorInitialValue = draft ?? original;

                                  return (
                                    <div
                                      key={loc.locale}
                                      className="grid items-start gap-3 border-b border-dashed border-border py-1.5 last:border-b-0"
                                      style={{
                                        gridTemplateColumns:
                                          '120px 160px 1fr auto',
                                      }}
                                    >
                                      {/* Locale tag */}
                                      <Badge
                                        variant="outline"
                                        className={cn(
                                          'justify-center text-xs',
                                          loc.locale === defaultLocale
                                            ? 'border-amber-400 bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300'
                                            : 'border-sky-400 bg-sky-50 text-sky-700 dark:bg-sky-950/30 dark:text-sky-300',
                                        )}
                                      >
                                        {loc.locale}
                                      </Badge>

                                      {/* Label + inherited tag */}
                                      <div className="flex flex-col gap-0.5">
                                        <span className="text-sm text-muted-foreground">
                                          {loc.label}
                                        </span>
                                        {isInherited && original && (
                                          <Badge
                                            variant="secondary"
                                            className="w-fit text-xs"
                                          >
                                            {t(
                                              'I18n.KeyTable.cell.inherited',
                                              '继承自全局',
                                            )}
                                          </Badge>
                                        )}
                                      </div>

                                      {/* Textarea editor */}
                                      <LocaleEditor
                                        key={`${dKey}|${original}`}
                                        initialValue={editorInitialValue}
                                        initiallyDirty={draft !== undefined}
                                        placeholder={cellPlaceholder}
                                        inherited={
                                          isInherited && draft === undefined
                                        }
                                        onCommit={(next) =>
                                          setCellValue(
                                            record.namespace,
                                            record.key,
                                            loc.locale,
                                            original,
                                            next,
                                          )
                                        }
                                      />

                                      {/* Reset button */}
                                      {onResetCell && !isInherited ? (
                                        <Button
                                          variant="ghost"
                                          size="xs"
                                          onClick={() => {
                                            onResetCell({
                                              namespace: record.namespace,
                                              key: record.key,
                                              locale: loc.locale,
                                            })
                                              .then(() => {
                                                if (
                                                  dirtyRef.current.delete(dKey)
                                                ) {
                                                  setDirtyCount(
                                                    dirtyRef.current.size,
                                                  );
                                                }
                                                return refreshKeys();
                                              })
                                              .then(() => {
                                                toast.success(
                                                  t(
                                                    'I18n.KeyTable.toast.resetSuccess',
                                                    '已重置为全局值',
                                                  ),
                                                );
                                              })
                                              .catch(() => {
                                                // Error already toasted by API client.
                                              });
                                          }}
                                        >
                                          {t(
                                            'I18n.KeyTable.cell.resetToGlobal',
                                            '重置为全局',
                                          )}
                                        </Button>
                                      ) : (
                                        <span />
                                      )}
                                    </div>
                                  );
                                })
                              )}

                              {/* Entry locations sub-table */}
                              {showEntryMeta && record.entryId && (
                                <div className="mt-3">
                                  <EntryLocationsRow
                                    entryId={record.entryId}
                                    locations={
                                      entryLocations[record.entryId] ?? []
                                    }
                                    loading={
                                      loadingLocations[record.entryId] ?? false
                                    }
                                    onLoad={loadLocations}
                                  />
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Loading overlay */}
        {loading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/60 backdrop-blur-[2px]">
            <span className="text-sm text-muted-foreground">
              {t('Common.loading', '加载中...')}
            </span>
          </div>
        )}
      </div>

      {/* Pagination */}
      {total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
          <span>
            {t('I18n.KeyTable.pagination.total', '共 {{count}} 个 key', {
              count: total,
            })}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="xs"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
            >
              {t('Common.prev', '上一页')}
            </Button>
            <span className="px-2">
              {page} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="xs"
              disabled={page >= totalPages}
              onClick={() => setPage(page + 1)}
            >
              {t('Common.next', '下一页')}
            </Button>
            <Select
              value={String(pageSize)}
              onValueChange={(v) => {
                setPageSize(Number(v));
                setPage(1);
              }}
            >
              <SelectTrigger className="h-7 w-20 text-xs" size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[20, 50, 100].map((size) => (
                  <SelectItem key={size} value={String(size)}>
                    {size}/页
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      )}

      {/* Save bar */}
      <div className="shrink-0 mt-3 flex items-center justify-between gap-3 rounded-md border bg-background px-4 py-3 shadow-lg">
        <span className="text-sm">
          {dirtyCount === 0
            ? t('I18n.KeyTable.bar.clean', '没有未保存的修改')
            : t('I18n.KeyTable.bar.dirty', '有 {{count}} 处未保存的修改', {
                count: dirtyCount,
              })}
        </span>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={dirtyCount === 0 || saving}
            onClick={discardAll}
          >
            {t('I18n.KeyTable.action.discard', '放弃修改')}
          </Button>
          <Button size="sm" disabled={dirtyCount === 0} onClick={flushAll}>
            {saving && (
              <Icon icon="lucide:loader-2" className="size-4 animate-spin" />
            )}
            {t('I18n.KeyTable.action.save', '保存全部')}
          </Button>
        </div>
      </div>
    </div>
  );
}
