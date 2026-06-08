import { Icon } from '@iconify/react';
import { useEffect, useMemo, useState } from 'react';
import type { ProTableColumnDef } from '@/components/pro-table';
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
import { useAppLogsAgent } from './agent';
import type { RequestLog, TraceDetail } from './options';
import {
  createAppLogTableColumns,
  getAppLogStats,
  getAppLogs,
  getTraceDetail,
} from './options';

const methodTextColors: Record<string, string> = {
  get: 'text-blue-500',
  post: 'text-green-500',
  put: 'text-orange-500',
  delete: 'text-red-500',
  patch: 'text-purple-500',
};

const statusVariants: Record<
  string,
  'default' | 'secondary' | 'outline' | 'destructive'
> = {
  '2xx': 'default',
  '3xx': 'secondary',
  '4xx': 'outline',
  '5xx': 'destructive',
};

const getStatusRange = (code: number) => {
  if (code < 300) return '2xx';
  if (code < 400) return '3xx';
  if (code < 500) return '4xx';
  return '5xx';
};

const getSpanBarColor = ({
  hasError,
  hasWarn,
  hasLogs,
}: {
  hasError: boolean;
  hasWarn: boolean;
  hasLogs: boolean;
}) => {
  if (hasError) {
    return 'bg-destructive/15 border-destructive/30 text-destructive';
  }
  if (hasWarn) {
    return 'bg-amber-500/15 border-amber-500/30 text-amber-600 dark:text-amber-400';
  }
  if (hasLogs) {
    return 'bg-blue-500/15 border-blue-500/30 text-blue-600 dark:text-blue-400';
  }
  return 'bg-muted/30 border-border text-muted-foreground';
};

const levelConfig: Record<
  string,
  { border: string; text: string; bg: string }
> = {
  error: {
    border: 'border-l-destructive',
    text: 'text-destructive',
    bg: 'bg-destructive/5',
  },
  warn: {
    border: 'border-l-amber-500',
    text: 'text-amber-600 dark:text-amber-400',
    bg: 'bg-amber-500/5',
  },
  info: {
    border: 'border-l-blue-500',
    text: 'text-blue-600 dark:text-blue-400',
    bg: 'bg-transparent',
  },
};

// ─── Parses fieldsJson (JSON string) into key-value pairs ────────

function parseFields(
  fieldsJson: Record<string, string> | string | null,
): Record<string, string> {
  if (!fieldsJson) return {};
  if (typeof fieldsJson === 'string') {
    try {
      return JSON.parse(fieldsJson);
    } catch {
      return {};
    }
  }
  return fieldsJson;
}

function normalizeLogFields(fields: Record<string, string>) {
  const displayFields: Record<string, string> = { ...fields };
  const location =
    displayFields.location ??
    (displayFields.file && displayFields.line
      ? `${displayFields.file}:${displayFields.line}${
          displayFields.column ? `:${displayFields.column}` : ''
        }`
      : undefined);

  delete displayFields.caller_file;
  delete displayFields.caller_line;
  delete displayFields.caller_column;
  delete displayFields.file;
  delete displayFields.line;
  delete displayFields.column;
  delete displayFields.location;

  if (location) {
    return { location, fields: displayFields };
  }
  return { location: null, fields: displayFields };
}

// ─── Flatten span tree for Gantt chart ──────────────────────────

interface FlatSpan {
  id: number;
  spanId: string;
  spanName: string;
  spanType: string | null;
  startTime: number;
  durationMs: number | null;
  depth: number;
}

function flattenSpans(
  nodes: TraceDetail['spans'],
  parentId: string | null,
  depth: number,
  acc: FlatSpan[],
) {
  const children = nodes
    .filter((s) =>
      parentId === null
        ? !s.parentSpanId || !nodes.some((n) => n.spanId === s.parentSpanId)
        : s.parentSpanId === parentId,
    )
    .sort((a, b) => a.startTime - b.startTime);

  for (const c of children) {
    acc.push({
      id: c.id,
      spanId: c.spanId,
      spanName: c.spanName,
      spanType: c.spanType,
      startTime: c.startTime,
      durationMs: c.durationMs,
      depth,
    });
    flattenSpans(nodes, c.spanId, depth + 1, acc);
  }

  return acc;
}

// ─── Trace Detail Sheet ─────────────────────────────────────────

const TraceDetailSheet = ({
  traceDetail,
  open,
  onOpenChange,
  loading,
}: {
  traceDetail: TraceDetail | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  loading: boolean;
}) => {
  const t = useT();
  const [selectedSpanId, setSelectedSpanId] = useState<string | null>(null);

  const ganttData = useMemo(() => {
    if (!traceDetail?.spans.length) return null;

    const flat = flattenSpans(traceDetail.spans, null, 0, []);
    const minStart = flat.reduce((m, s) => Math.min(m, s.startTime), Infinity);
    const maxEnd = flat.reduce(
      (m, s) => Math.max(m, s.startTime + (s.durationMs ?? 0)),
      -Infinity,
    );
    const totalDur = maxEnd - minStart || 1;

    return { spans: flat, minStart, totalDur };
  }, [traceDetail]);

  const filteredEntries = useMemo(() => {
    if (!traceDetail) return [];
    if (!selectedSpanId) return traceDetail.entries;
    return traceDetail.entries.filter((e) => e.spanId === selectedSpanId);
  }, [traceDetail, selectedSpanId]);

  const req = traceDetail?.request;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="left"
        className="flex flex-col !w-[60vw] !max-w-[60vw]"
      >
        <SheetHeader className="shrink-0">
          <SheetTitle className="text-sm">
            {req
              ? t('AppLogMgmt.detail.titleWithId', '{{traceId}}', {
                  traceId: req.traceId.slice(0, 8),
                })
              : t('AppLogMgmt.detail.title', '请求详情')}
          </SheetTitle>
          {req && (
            <SheetDescription className="flex items-center gap-2">
              <span className="truncate text-xs font-mono">{req.method}</span>
              <span className="truncate font-mono text-[11px]">{req.path}</span>
            </SheetDescription>
          )}
        </SheetHeader>

        {loading && (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            {t('AppLogMgmt.detail.loading', '加载中...')}
          </div>
        )}

        {!loading && !traceDetail && (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            {t('AppLogMgmt.detail.notFound', '未找到该请求的追踪信息')}
          </div>
        )}

        {!loading && req && (
          <div className="flex-1 overflow-y-auto space-y-3 px-4 pb-4">
            {/* Metadata chips */}
            <div className="flex flex-wrap items-center gap-1.5">
              {req.statusCode != null ? (
                <Badge
                  variant={
                    statusVariants[getStatusRange(req.statusCode)] ??
                    'secondary'
                  }
                  className="text-xs"
                >
                  {req.statusCode}
                </Badge>
              ) : (
                <span className="text-xs text-muted-foreground">-</span>
              )}
              <span className="text-[11px] text-muted-foreground">·</span>
              <span
                className={cn(
                  'text-xs tabular-nums',
                  req.durationMs != null &&
                    req.durationMs > 1000 &&
                    'text-red-500',
                  req.durationMs != null &&
                    req.durationMs > 300 &&
                    req.durationMs <= 1000 &&
                    'text-orange-500',
                )}
              >
                {req.durationMs != null ? `${req.durationMs}ms` : '-'}
              </span>
              <span className="text-[11px] text-muted-foreground">·</span>
              <span className="text-xs text-muted-foreground font-mono">
                {req.ipAddress ?? '-'}
              </span>
              <span className="text-[11px] text-muted-foreground">·</span>
              <span className="truncate text-xs text-muted-foreground font-mono">
                {req.traceId.slice(0, 12)}…
              </span>
            </div>

            {req.error && (
              <div className="rounded border border-destructive/30 bg-destructive/5 px-3 py-1.5 text-xs text-destructive">
                {req.error}
              </div>
            )}

            {/* ── Gantt chart ── */}
            {ganttData && (
              <div>
                <h4 className="mb-1.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                  Spans
                  <span className="ml-1 font-normal normal-case">
                    ({ganttData.spans.length})
                  </span>
                </h4>
                <div className="overflow-hidden rounded-lg border bg-card">
                  {/* Time scale header */}
                  <div className="grid grid-cols-[1fr_3fr] border-b bg-muted/50 px-2 py-1 text-[10px] font-mono text-muted-foreground">
                    <span>Span</span>
                    <div className="grid grid-cols-4">
                      <span>0ms</span>
                      <span>{Math.round(ganttData.totalDur * 0.25)}</span>
                      <span>{Math.round(ganttData.totalDur * 0.5)}</span>
                      <span className="text-right">{ganttData.totalDur}ms</span>
                    </div>
                  </div>

                  {/* Span rows */}
                  <div className="divide-y">
                    {ganttData.spans.map((span) => {
                      const isSelected = selectedSpanId === span.spanId;
                      const dur = span.durationMs ?? 0;
                      const offset =
                        ((span.startTime - ganttData.minStart) /
                          ganttData.totalDur) *
                        100;
                      const width = Math.max(
                        (dur / ganttData.totalDur) * 100,
                        2,
                      );

                      // Bar color follows worst log level of associated entries
                      const spanEntries = traceDetail.entries.filter(
                        (e) => e.spanId === span.spanId,
                      );
                      const hasError = spanEntries.some(
                        (e) => e.level === 'ERROR',
                      );
                      const hasWarn = spanEntries.some(
                        (e) => e.level === 'WARN',
                      );
                      const hasLogs = spanEntries.length > 0;
                      const barColor = getSpanBarColor({
                        hasError,
                        hasWarn,
                        hasLogs,
                      });

                      // Look up raw span for fieldsJson
                      const rawSpan = traceDetail.spans.find(
                        (s) => s.spanId === span.spanId,
                      );
                      const fields = parseFields(rawSpan?.fieldsJson ?? null);

                      return (
                        <div key={span.spanId}>
                          <button
                            type="button"
                            className={cn(
                              'grid w-full grid-cols-[1fr_3fr] items-center px-2 py-1 text-left hover:bg-accent/50 transition-colors',
                              isSelected && 'bg-accent',
                            )}
                            onClick={() =>
                              setSelectedSpanId(isSelected ? null : span.spanId)
                            }
                          >
                            <span
                              className="flex min-w-0 items-center gap-1 pr-1"
                              style={{ paddingLeft: `${span.depth * 12}px` }}
                            >
                              {span.depth > 0 && (
                                <Icon
                                  icon="lucide:corner-down-right"
                                  className="size-3 shrink-0 text-muted-foreground/40"
                                />
                              )}
                              <span
                                className={cn(
                                  'text-[9px] font-mono font-semibold whitespace-nowrap',
                                  barColor,
                                )}
                              >
                                {span.spanName}
                              </span>
                            </span>

                            {/* Bar area */}
                            <div className="relative h-5 overflow-hidden">
                              <div className="absolute inset-0 grid grid-cols-4">
                                {[0, 1, 2, 3].map((i) => (
                                  <div
                                    key={i}
                                    className="border-r border-border/30 last:border-r-0"
                                  />
                                ))}
                              </div>
                              <div
                                className={cn(
                                  'absolute top-0.5 h-4 rounded border px-1.5 flex items-center',
                                  barColor,
                                )}
                                style={{
                                  left: `${offset}%`,
                                  width: `${width}%`,
                                }}
                              >
                                <span
                                  className={cn(
                                    'text-[9px] font-mono font-semibold whitespace-nowrap',
                                    barColor,
                                  )}
                                >
                                  {dur}ms
                                </span>
                              </div>
                            </div>
                          </button>

                          {/* Expanded span detail — terminal console style */}
                          {isSelected && rawSpan && (
                            <div className="bg-slate-950 text-slate-200 font-mono text-xs border-t border-slate-800">
                              <div className="flex items-center gap-2 px-3 py-1.5 border-b border-slate-800 text-[10px] text-slate-500 select-none">
                                <span className="size-1.5 rounded-full bg-emerald-500" />
                                <span className="text-slate-200 font-semibold">
                                  {rawSpan.spanName}
                                </span>
                                <span className="px-1 py-px rounded bg-slate-800 text-slate-400">
                                  {rawSpan.spanType ?? 'unknown'}
                                </span>
                                <span className="ml-auto tabular-nums text-emerald-400">
                                  {rawSpan.durationMs}ms
                                </span>
                              </div>
                              <div className="p-2.5">
                                {Object.keys(fields).length > 0 ? (
                                  <div className="flex flex-wrap gap-1.5">
                                    {Object.entries(fields).map(([k, v]) => (
                                      <span
                                        key={k}
                                        className="inline-flex items-baseline gap-1 px-2 py-0.5 rounded bg-slate-800/80 border border-slate-700/50"
                                      >
                                        <span className="text-slate-500">
                                          {k}
                                        </span>
                                        <span className="text-cyan-400">
                                          {v}
                                        </span>
                                      </span>
                                    ))}
                                  </div>
                                ) : (
                                  <span className="text-slate-500 italic">
                                    No fields
                                  </span>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* ── Terminal log console ── */}
            {filteredEntries.length > 0 && (
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <h4 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                    Logs
                    <span className="ml-1 font-normal normal-case">
                      ({filteredEntries.length})
                    </span>
                  </h4>
                  {selectedSpanId && (
                    <Button
                      variant="ghost"
                      size="xs"
                      className="h-5 text-[10px]"
                      onClick={() => setSelectedSpanId(null)}
                    >
                      {t('AppLogMgmt.detail.resetFilter', '显示全部')}
                    </Button>
                  )}
                </div>

                <div className="overflow-hidden rounded-lg border bg-slate-950 text-slate-200 font-mono text-xs">
                  {/* Console header */}
                  <div className="flex items-center justify-between border-b border-slate-800 px-3 py-1.5 text-[10px] text-slate-500 select-none">
                    <div className="flex items-center gap-1.5">
                      <span className="size-2 rounded-full bg-slate-700" />
                      <span>Knota-Fold Logs</span>
                    </div>
                    <span className="text-slate-600">
                      {filteredEntries.length} entries
                    </span>
                  </div>

                  <div className="max-h-[300px] overflow-y-auto p-2.5 space-y-2">
                    {filteredEntries.map((entry) => {
                      const cfg =
                        levelConfig[entry.level.toLowerCase()] ??
                        levelConfig.info;
                      const { location, fields } = normalizeLogFields(
                        parseFields(entry.fieldsJson),
                      );
                      const isWarn = entry.level === 'WARN';

                      return (
                        <div
                          key={entry.id}
                          className={cn(
                            'border-l-4 rounded-r pl-3 py-1',
                            cfg.border,
                            cfg.bg,
                          )}
                        >
                          {/* Row 1: timestamp + level + target */}
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-slate-500">
                            <span>
                              {new Date(entry.timestamp).toISOString()}
                            </span>
                            <span
                              className={cn(
                                'px-1 py-px rounded font-bold',
                                isWarn
                                  ? 'bg-amber-500/20 text-amber-400'
                                  : 'bg-blue-500/20 text-blue-400',
                              )}
                            >
                              [{entry.level}]
                            </span>
                            {entry.target && (
                              <span className="text-slate-400">
                                {entry.target}
                              </span>
                            )}
                            {location && (
                              <span className="text-emerald-400">
                                {location}
                              </span>
                            )}
                          </div>

                          {/* Row 2: message */}
                          <div className="mt-0.5 text-sm text-slate-100">
                            {entry.message ?? '\u00A0'}
                          </div>

                          {/* Row 3: structured fields — inline */}
                          {Object.keys(fields).length > 0 && (
                            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]">
                              {Object.entries(fields).map(([k, v]) => (
                                <span
                                  key={k}
                                  className="inline-flex items-baseline gap-1"
                                >
                                  <span className="text-slate-500">{k}</span>
                                  <span className="text-cyan-400">{v}</span>
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
};

// ─── Page ─────────────────────────────────────────────────

const AppLogsPage = () => {
  useAppLogsAgent();
  const t = useT();

  const [droppedCount, setDroppedCount] = useState(0);
  const [detailOpen, setDetailOpen] = useState(false);
  const [traceId, setTraceId] = useState<string | null>(null);

  useEffect(() => {
    void getAppLogStats()
      .then((res) => setDroppedCount(res.droppedCount ?? 0))
      .catch(() => {});
  }, []);

  const [traceDetail, setTraceDetail] = useState<TraceDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    if (!traceId) {
      setTraceDetail(null);
      return;
    }
    setDetailLoading(true);
    getTraceDetail(traceId)
      .then((d) => setTraceDetail(d))
      .catch(() => setTraceDetail(null))
      .finally(() => setDetailLoading(false));
  }, [traceId]);

  const columns = useMemo(
    () =>
      buildColumns<RequestLog>(createAppLogTableColumns(t), {
        timestamp: ({ row }) =>
          new Date(row.original.timestamp).toLocaleString(),
        method: ({ row }) => {
          const color = methodTextColors[row.original.method.toLowerCase()];
          return (
            <span className={cn('font-mono text-xs font-semibold', color)}>
              {row.original.method}
            </span>
          );
        },
        statusCode: ({ row }) => {
          const code = row.original.statusCode;
          if (code == null)
            return <span className="text-muted-foreground">-</span>;
          const range = getStatusRange(code);
          const variant = statusVariants[range] ?? 'secondary';
          return <Badge variant={variant}>{code}</Badge>;
        },
        durationMs: ({ row }) => {
          const ms = row.original.durationMs;
          if (ms == null)
            return <span className="text-muted-foreground">-</span>;
          return (
            <span
              className={cn(
                'font-mono text-sm',
                ms > 1000 && 'text-red-500',
                ms > 300 && ms <= 1000 && 'text-orange-500',
              )}
            >
              {ms}ms
            </span>
          );
        },
        ipAddress: ({ row }) => row.original.ipAddress ?? '-',
        traceId: ({ row }) => (
          <button
            type="button"
            className="cursor-pointer font-mono text-xs text-primary hover:underline"
            title={row.original.traceId}
            onClick={() => {
              setTraceId(row.original.traceId);
              setDetailOpen(true);
            }}
          >
            {row.original.traceId}
          </button>
        ),
        error: ({ row }) =>
          row.original.error ? (
            <span
              className="text-destructive text-sm max-w-[200px] truncate"
              title={row.original.error}
            >
              {row.original.error}
            </span>
          ) : (
            <span className="text-muted-foreground">-</span>
          ),
      }) as ProTableColumnDef<RequestLog>[],
    [t],
  );

  return (
    <>
      {droppedCount > 0 && (
        <div className="mb-4 rounded-md border border-yellow-500/50 bg-yellow-50 px-4 py-3 text-sm text-yellow-800 dark:bg-yellow-950/20 dark:text-yellow-200">
          {t('AppLogMgmt.droppedWarning', '{{count}} 条日志因通道满已丢弃', {
            count: droppedCount,
          })}
        </div>
      )}
      <ProTable
        columns={columns}
        request={(params) =>
          getAppLogs({
            page: params.page,
            pageSize: params.pageSize,
            method: params.method as string | undefined,
            path: params.path as string | undefined,
            statusCode: params.statusCode
              ? Number(params.statusCode)
              : undefined,
            q: params.q as string | undefined,
            traceId: params.traceId as string | undefined,
            ipAddress: params.ipAddress as string | undefined,
            from: params.from as number | undefined,
            to: params.to as number | undefined,
            hasError: params.hasError as boolean | undefined,
            minDuration: params.minDuration as number | undefined,
            maxDuration: params.maxDuration as number | undefined,
            userId: params.userId as string | undefined,
          })
        }
        header={{ title: t('AppLogMgmt.title', '应用日志') }}
      />

      <TraceDetailSheet
        traceDetail={traceDetail ?? null}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        loading={detailLoading}
      />
    </>
  );
};

export default AppLogsPage;
