import { Icon } from '@iconify/react';
import { useRequest } from 'ahooks';
import { useCallback, useMemo, useRef, useState } from 'react';
import type { ProTableColumnDef, ProTableRef } from '@/components/pro-table';
import { buildColumns, ProTable } from '@/components/pro-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useT } from '@/i18n';
import { cn } from '@/lib/utils';
import { toast } from '@/utils/toast';
import { useSchedulerAgent } from './agent';
import { GrantTenantsDialog } from './GrantTenantsDialog';
import type {
  WorkerDefinitionResponse,
  WorkerExecutionResponse,
  WorkerScheduleResponse,
} from './options';
import {
  createExecutionTableColumns,
  createScheduleTableColumns,
  createWorkerDefTableColumns,
  deleteWorkerSchedule,
  getWorkerExecution,
  listWorkerDefinitions,
  listWorkerExecutions,
  listWorkerSchedules,
  patchWorkerDefinitionStatus,
  patchWorkerScheduleStatus,
  triggerWorkerSchedule,
} from './options';
import { ScheduleDialog } from './ScheduleDialog';
import { WorkerDefDialog } from './WorkerDefDialog';

// ─── Helpers ────────────────────────────────────────────────

const copyToClipboard = (
  text: string,
  t: (key: string, fb: string) => string,
) => {
  void navigator.clipboard.writeText(text).then(() => {
    toast.success(t('Common.toast.copied', '已复制'));
  });
};

const formatDuration = (ms: number | null): React.ReactNode => {
  if (ms == null) return '-';
  return (
    <span
      className={cn(
        ms > 1000 && 'text-red-600',
        ms > 300 && ms <= 1000 && 'text-orange-500',
      )}
    >
      {ms}ms
    </span>
  );
};

// ─── Confirm dialog state type ──────────────────────────────

interface ConfirmState {
  title: string;
  description: string;
  onConfirm: () => void;
}

// ─── Badge label maps ───────────────────────────────────────

const useBadgeLabels = (
  t: (key: string, fb: string, params?: Record<string, string>) => string,
) =>
  useMemo(
    () => ({
      statusActive: t('SchedulerMgmt.badge.active', '启用'),
      statusDisabled: t('SchedulerMgmt.badge.disabled', '停用'),
      concurrentYes: t('SchedulerMgmt.badge.yes', '是'),
      concurrentNo: t('SchedulerMgmt.badge.no', '否'),
      enabled: t('SchedulerMgmt.badge.enabled', '已启用'),
      disabled: t('SchedulerMgmt.badge.disabled', '停用'),
      triggerManual: t('SchedulerMgmt.badge.manual', '手动触发'),
      triggerScheduled: t('SchedulerMgmt.badge.scheduled', '定时触发'),
      execPending: t('SchedulerMgmt.badge.pending', '待执行'),
      execRunning: t('SchedulerMgmt.badge.running', '执行中'),
      execSuccess: t('SchedulerMgmt.badge.success', '成功'),
      execFailed: t('SchedulerMgmt.badge.failed', '失败'),
      execSkipped: t('SchedulerMgmt.badge.skipped', '跳过'),
    }),
    [t],
  );

const executionStatusVariant = (
  status: string,
): 'default' | 'secondary' | 'destructive' | 'outline' => {
  switch (status) {
    case 'pending':
      return 'secondary';
    case 'running':
      return 'default';
    case 'success':
      return 'default';
    case 'failed':
      return 'destructive';
    case 'skipped':
      return 'outline';
    default:
      return 'secondary';
  }
};

const triggerTypeVariant = (type: string): 'default' | 'secondary' => {
  switch (type) {
    case 'manual':
      return 'default';
    case 'scheduled':
      return 'secondary';
    default:
      return 'secondary';
  }
};

const getTriggerTypeLabel = (
  type: string,
  labels: {
    triggerManual: string;
    triggerScheduled: string;
  },
) => {
  if (type === 'manual') return labels.triggerManual;
  if (type === 'scheduled') return labels.triggerScheduled;
  return type;
};

const getExecutionStatusLabel = (
  status: string,
  labels: {
    execPending: string;
    execRunning: string;
    execSuccess: string;
    execFailed: string;
    execSkipped: string;
  },
) => {
  if (status === 'pending') return labels.execPending;
  if (status === 'running') return labels.execRunning;
  if (status === 'success') return labels.execSuccess;
  if (status === 'failed') return labels.execFailed;
  if (status === 'skipped') return labels.execSkipped;
  return status;
};

// ─── Page ───────────────────────────────────────────────────

type TabKey = 'definitions' | 'schedules' | 'executions';

const SchedulerPage = () => {
  const t = useT();
  useSchedulerAgent();
  const labels = useBadgeLabels(t);

  const [activeTab, setActiveTab] = useState<TabKey>('definitions');

  // ─── Definition state ─────────────────────────────────
  const [createDefOpen, setCreateDefOpen] = useState(false);
  const [editDef, setEditDef] = useState<WorkerDefinitionResponse | null>(null);
  const [grantDef, setGrantDef] = useState<WorkerDefinitionResponse | null>(
    null,
  );
  const defTableRef = useRef<ProTableRef>(null);
  const [workerDefs, setWorkerDefs] = useState<WorkerDefinitionResponse[]>([]);

  // ─── Schedule state ───────────────────────────────────
  const [createScheduleOpen, setCreateScheduleOpen] = useState(false);
  const [editSchedule, setEditSchedule] =
    useState<WorkerScheduleResponse | null>(null);
  const scheduleTableRef = useRef<ProTableRef>(null);

  // ─── Execution state ──────────────────────────────────
  const execTableRef = useRef<ProTableRef>(null);
  const [execDetail, setExecDetail] = useState<WorkerExecutionResponse | null>(
    null,
  );

  // ─── Confirm dialog state ─────────────────────────────
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  // ─── Status toggle hooks ──────────────────────────────

  const { run: toggleDefStatus } = useRequest(
    (code: string, currentStatus: string) => {
      const next = currentStatus === 'active' ? 'disabled' : 'active';
      return patchWorkerDefinitionStatus(code, next);
    },
    {
      manual: true,
      onSuccess: (_data, [_code, currentStatus]) => {
        toast.success(
          currentStatus === 'active'
            ? t('SchedulerMgmt.toast.disabled', '已停用')
            : t('SchedulerMgmt.toast.enabled', '已启用'),
        );
        defTableRef.current?.refresh();
      },
    },
  );

  const { run: toggleScheduleEnabled } = useRequest(
    (id: string, currentEnabled: boolean) =>
      patchWorkerScheduleStatus(id, !currentEnabled),
    {
      manual: true,
      onSuccess: (_data, [_id, currentEnabled]) => {
        toast.success(
          currentEnabled
            ? t('SchedulerMgmt.toast.disabled', '已停用')
            : t('SchedulerMgmt.toast.enabled', '已启用'),
        );
        scheduleTableRef.current?.refresh();
      },
    },
  );

  const { run: triggerSchedule } = useRequest(triggerWorkerSchedule, {
    manual: true,
    onSuccess: (res) => {
      toast.success(
        t('SchedulerMgmt.toast.triggerSuccess', '已触发执行，执行 ID：{{id}}', {
          id: res.executionId,
        }),
      );
      scheduleTableRef.current?.refresh();
    },
  });

  const { run: removeSchedule } = useRequest(deleteWorkerSchedule, {
    manual: true,
    onSuccess: () => {
      toast.success(t('SchedulerMgmt.toast.deleted', '删除成功'));
      scheduleTableRef.current?.refresh();
    },
  });

  const { run: loadExecDetail, loading: detailLoading } = useRequest(
    getWorkerExecution,
    {
      manual: true,
      onSuccess: (detail) => {
        setExecDetail(detail);
      },
    },
  );

  // ─── Refresh handlers ─────────────────────────────────

  const handleDefSuccess = useCallback(() => {
    defTableRef.current?.refresh();
  }, []);

  const handleScheduleSuccess = useCallback(() => {
    scheduleTableRef.current?.refresh();
  }, []);

  const handleGrantSuccess = useCallback(() => {
    defTableRef.current?.refresh();
  }, []);

  // ─── Definition table columns ─────────────────────────

  const defColumns = useMemo(
    () =>
      buildColumns<WorkerDefinitionResponse>(createWorkerDefTableColumns(t), {
        code: ({ row }) => {
          const code = row.original.code;
          return (
            <div className="flex items-center gap-1">
              <span className="truncate">{code}</span>
              <button
                type="button"
                className="inline-flex shrink-0 cursor-pointer items-center justify-center text-muted-foreground hover:text-foreground"
                onClick={(e) => {
                  e.stopPropagation();
                  copyToClipboard(code, t);
                }}
              >
                <Icon icon="lucide:copy" className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        },
        category: ({ row }) => (
          <Badge variant="secondary">{row.original.category}</Badge>
        ),
        status: ({ row }) => {
          const def = row.original;
          const isActive = def.status === 'active';
          return (
            <Switch
              checked={isActive}
              onClick={(e) => {
                e.stopPropagation();
                setConfirm({
                  title: t(
                    'SchedulerMgmt.confirm.toggleDefStatus',
                    '确认切换任务状态？',
                  ),
                  description: t(
                    'SchedulerMgmt.confirm.toggleDefStatusDesc',
                    '将「{{name}}」状态切换为 {{next}}',
                    {
                      name: def.name,
                      next: isActive
                        ? labels.statusDisabled
                        : labels.statusActive,
                    },
                  ),
                  onConfirm: () => toggleDefStatus(def.code, def.status),
                });
              }}
            />
          );
        },
        allowConcurrent: ({ row }) => (
          <Badge variant={row.original.allowConcurrent ? 'default' : 'outline'}>
            {row.original.allowConcurrent
              ? labels.concurrentYes
              : labels.concurrentNo}
          </Badge>
        ),
        actions: ({ row }) => {
          const def = row.original;
          return (
            <div className="inline-flex items-center gap-1">
              <Button variant="ghost" size="xs" onClick={() => setEditDef(def)}>
                {t('SchedulerMgmt.action.edit', '编辑')}
              </Button>
              <Button
                variant="ghost"
                size="xs"
                onClick={() => setGrantDef(def)}
              >
                {t('SchedulerMgmt.action.grantTenants', '授权租户')}
              </Button>
            </div>
          );
        },
      }) as ProTableColumnDef<WorkerDefinitionResponse>[],
    [labels, t, toggleDefStatus],
  );

  // ─── Schedule table columns ───────────────────────────

  const scheduleColumns = useMemo(
    () =>
      buildColumns<WorkerScheduleResponse>(createScheduleTableColumns(t), {
        workerName: ({ row }) =>
          row.original.workerName || row.original.workerCode || '-',
        cronExpr: ({ row }) => {
          const expr = row.original.cronExpr;
          return (
            <div className="flex items-center gap-1">
              <span className="truncate">{expr}</span>
              <button
                type="button"
                className="inline-flex shrink-0 cursor-pointer items-center justify-center text-muted-foreground hover:text-foreground"
                onClick={(e) => {
                  e.stopPropagation();
                  copyToClipboard(expr, t);
                }}
              >
                <Icon icon="lucide:copy" className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        },
        paramsJson: ({ row }) => (
          <span className="truncate">{row.original.paramsJson || '-'}</span>
        ),
        enabled: ({ row }) => {
          const schedule = row.original;
          return (
            <Switch
              checked={schedule.enabled}
              onClick={(e) => {
                e.stopPropagation();
                setConfirm({
                  title: t(
                    'SchedulerMgmt.confirm.toggleScheduleStatus',
                    '确认切换调度状态？',
                  ),
                  description: t(
                    'SchedulerMgmt.confirm.toggleScheduleStatusDesc',
                    '将「{{name}}」切换为 {{next}}',
                    {
                      name: schedule.name,
                      next: schedule.enabled ? labels.disabled : labels.enabled,
                    },
                  ),
                  onConfirm: () =>
                    toggleScheduleEnabled(schedule.id, schedule.enabled),
                });
              }}
            />
          );
        },
        lastRunAt: ({ row }) => row.original.lastRunAt || '-',
        nextRunAt: ({ row }) => row.original.nextRunAt || '-',
        actions: ({ row }) => {
          const schedule = row.original;
          return (
            <div className="inline-flex items-center gap-1">
              <Button
                variant="ghost"
                size="xs"
                onClick={() => setEditSchedule(schedule)}
              >
                {t('SchedulerMgmt.action.edit', '编辑')}
              </Button>
              <Button
                variant="ghost"
                size="xs"
                onClick={(e) => {
                  e.stopPropagation();
                  setConfirm({
                    title: t('SchedulerMgmt.confirm.trigger', '确认立即执行？'),
                    description: t(
                      'SchedulerMgmt.confirm.triggerDesc',
                      '将手动触发「{{name}}」执行一次',
                      { name: schedule.name },
                    ),
                    onConfirm: () => triggerSchedule(schedule.id),
                  });
                }}
              >
                {t('SchedulerMgmt.action.trigger', '立即执行')}
              </Button>
              <Button
                variant="ghost"
                size="xs"
                className="text-destructive hover:text-destructive"
                onClick={(e) => {
                  e.stopPropagation();
                  setConfirm({
                    title: t('SchedulerMgmt.confirm.delete', '确认删除？'),
                    description: t(
                      'SchedulerMgmt.confirm.deleteDesc',
                      '将删除调度计划「{{name}}」，此操作不可撤销',
                      { name: schedule.name },
                    ),
                    onConfirm: () => removeSchedule(schedule.id),
                  });
                }}
              >
                {t('SchedulerMgmt.action.delete', '删除')}
              </Button>
            </div>
          );
        },
      }) as ProTableColumnDef<WorkerScheduleResponse>[],
    [labels, t, toggleScheduleEnabled, triggerSchedule, removeSchedule],
  );

  // ─── Execution table columns ──────────────────────────

  const execColumns = useMemo(
    () =>
      buildColumns<WorkerExecutionResponse>(createExecutionTableColumns(t), {
        workerName: ({ row }) =>
          row.original.workerName || row.original.workerCode || '-',
        scheduleName: ({ row }) => row.original.scheduleName || '-',
        triggerType: ({ row }) => {
          const type = row.original.triggerType;
          const label = getTriggerTypeLabel(type, labels);
          return <Badge variant={triggerTypeVariant(type)}>{label}</Badge>;
        },
        status: ({ row }) => {
          const status = row.original.status;
          const statusLabelMap: Record<string, string> = {
            pending: labels.execPending,
            running: labels.execRunning,
            success: labels.execSuccess,
            failed: labels.execFailed,
            skipped: labels.execSkipped,
          };
          const label = statusLabelMap[status] ?? status;
          return (
            <Badge variant={executionStatusVariant(status)}>{label}</Badge>
          );
        },
        retryCount: ({ row }) => row.original.retryCount,
        startedAt: ({ row }) => row.original.startedAt || '-',
        durationMs: ({ row }) => formatDuration(row.original.durationMs),
        actions: ({ row }) => (
          <Button
            variant="ghost"
            size="xs"
            onClick={() => {
              setExecDetail(null);
              loadExecDetail(row.original.id);
            }}
          >
            {t('SchedulerMgmt.action.detail', '详情')}
          </Button>
        ),
      }) as ProTableColumnDef<WorkerExecutionResponse>[],
    [labels, t, loadExecDetail],
  );

  // ─── Render ───────────────────────────────────────────

  return (
    <div className="flex h-full flex-col gap-4 p-4">
      <div className="flex shrink-0 items-center justify-between">
        <h1 className="text-xl font-semibold">
          {t('SchedulerMgmt.title', '任务调度')}
        </h1>
      </div>

      {/* Tab bar */}
      <Tabs
        className="min-h-0 flex-1"
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as TabKey)}
      >
        <TabsList variant="line">
          <TabsTrigger value="definitions">
            {t('SchedulerMgmt.tab.definitions', '任务定义')}
          </TabsTrigger>
          <TabsTrigger value="schedules">
            {t('SchedulerMgmt.tab.schedules', '任务调度')}
          </TabsTrigger>
          <TabsTrigger value="executions">
            {t('SchedulerMgmt.tab.executions', '执行记录')}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="definitions" className="overflow-hidden">
          <ProTable
            ref={defTableRef}
            columns={defColumns}
            request={async () => {
              const data = await listWorkerDefinitions();
              setWorkerDefs(data);
              return data;
            }}
            header={{
              title: t('SchedulerMgmt.tab.definitions', '任务定义'),
              toolbar: (
                <Button onClick={() => setCreateDefOpen(true)}>
                  {t('SchedulerMgmt.action.createWorkerDef', '新建任务定义')}
                </Button>
              ),
            }}
            search={false}
            pagination={false}
          />
        </TabsContent>

        <TabsContent value="schedules" className="overflow-hidden">
          <ProTable
            ref={scheduleTableRef}
            columns={scheduleColumns}
            request={() => listWorkerSchedules()}
            header={{
              title: t('SchedulerMgmt.tab.schedules', '任务调度'),
              toolbar: (
                <Button onClick={() => setCreateScheduleOpen(true)}>
                  {t('SchedulerMgmt.action.createSchedule', '新建调度计划')}
                </Button>
              ),
            }}
            search={false}
            pagination={false}
          />
        </TabsContent>

        <TabsContent value="executions" className="overflow-hidden">
          <ProTable
            ref={execTableRef}
            columns={execColumns}
            request={(params) =>
              listWorkerExecutions({
                page: params.page,
                pageSize: params.pageSize,
              })
            }
            header={{
              title: t('SchedulerMgmt.tab.executions', '执行记录'),
            }}
            search={false}
          />
        </TabsContent>
      </Tabs>

      {/* ─── Dialogs ─────────────────────────────────────── */}

      {/* Worker Definition Dialog */}
      <WorkerDefDialog
        open={createDefOpen || !!editDef}
        workerDef={editDef}
        onOpenChange={(open) => {
          if (!open) {
            setCreateDefOpen(false);
            setEditDef(null);
          }
        }}
        onSuccess={() => {
          setCreateDefOpen(false);
          setEditDef(null);
          handleDefSuccess();
        }}
      />

      {/* Grant Tenants Dialog */}
      <GrantTenantsDialog
        open={!!grantDef}
        workerDef={grantDef}
        onOpenChange={(open) => {
          if (!open) setGrantDef(null);
        }}
        onSuccess={handleGrantSuccess}
      />

      {/* Schedule Dialog */}
      <ScheduleDialog
        open={createScheduleOpen || !!editSchedule}
        schedule={editSchedule}
        workerDefs={workerDefs}
        onOpenChange={(open) => {
          if (!open) {
            setCreateScheduleOpen(false);
            setEditSchedule(null);
          }
        }}
        onSuccess={() => {
          setCreateScheduleOpen(false);
          setEditSchedule(null);
          handleScheduleSuccess();
        }}
      />

      {/* Confirm Dialog */}
      <Dialog
        open={!!confirm}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
      >
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>{confirm?.title}</DialogTitle>
            <DialogDescription>{confirm?.description}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(null)}>
              {t('SchedulerMgmt.dialog.cancel', '取消')}
            </Button>
            <Button
              onClick={() => {
                confirm?.onConfirm();
                setConfirm(null);
              }}
            >
              {t('SchedulerMgmt.dialog.confirm', '确认')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Execution Detail Dialog */}
      <Dialog
        open={!!execDetail || detailLoading}
        onOpenChange={(open) => {
          if (!open) setExecDetail(null);
        }}
      >
        <DialogContent className="sm:max-w-[700px] max-h-[85vh]">
          <DialogHeader>
            <DialogTitle>
              {t('SchedulerMgmt.dialog.execDetail', '执行详情')}
            </DialogTitle>
            <DialogDescription>
              {execDetail
                ? t(
                    'SchedulerMgmt.dialog.execDetailDesc',
                    '{{name}} — {{status}}',
                    {
                      name:
                        execDetail.workerName ||
                        execDetail.workerCode ||
                        execDetail.id,
                      status: execDetail.status,
                    },
                  )
                : t('SchedulerMgmt.loading', '加载中...')}
            </DialogDescription>
          </DialogHeader>

          {execDetail && (
            <div className="max-h-[65vh] overflow-y-auto space-y-6 py-4">
              {/* Metadata grid */}
              <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                <div>
                  <span className="text-muted-foreground">
                    {t('SchedulerMgmt.field.workerName', '任务名称')}
                  </span>
                  <div>
                    {execDetail.workerName || execDetail.workerCode || '-'}
                  </div>
                </div>
                <div>
                  <span className="text-muted-foreground">
                    {t('SchedulerMgmt.field.scheduleName', '计划名称')}
                  </span>
                  <div>{execDetail.scheduleName || '-'}</div>
                </div>
                <div>
                  <span className="text-muted-foreground">
                    {t('SchedulerMgmt.field.triggerType', '触发方式')}
                  </span>
                  <div>
                    <Badge variant={triggerTypeVariant(execDetail.triggerType)}>
                      {getTriggerTypeLabel(execDetail.triggerType, labels)}
                    </Badge>
                  </div>
                </div>
                <div>
                  <span className="text-muted-foreground">
                    {t('SchedulerMgmt.column.status', '状态')}
                  </span>
                  <div>
                    <Badge variant={executionStatusVariant(execDetail.status)}>
                      {getExecutionStatusLabel(execDetail.status, labels)}
                    </Badge>
                  </div>
                </div>
                <div>
                  <span className="text-muted-foreground">
                    {t('SchedulerMgmt.field.startedAt', '开始时间')}
                  </span>
                  <div>{execDetail.startedAt || '-'}</div>
                </div>
                <div>
                  <span className="text-muted-foreground">
                    {t('SchedulerMgmt.field.finishedAt', '结束时间')}
                  </span>
                  <div>{execDetail.finishedAt || '-'}</div>
                </div>
                <div>
                  <span className="text-muted-foreground">
                    {t('SchedulerMgmt.field.durationMs', '耗时')}
                  </span>
                  <div>{formatDuration(execDetail.durationMs)}</div>
                </div>
                <div>
                  <span className="text-muted-foreground">
                    {t('SchedulerMgmt.field.retryCount', '重试次数')}
                  </span>
                  <div>{execDetail.retryCount}</div>
                </div>
                {execDetail.triggeredBy && (
                  <div>
                    <span className="text-muted-foreground">
                      {t('SchedulerMgmt.field.triggeredBy', '触发人')}
                    </span>
                    <div>{execDetail.triggeredBy}</div>
                  </div>
                )}
              </div>

              {/* Params */}
              {execDetail.paramsJson && (
                <div>
                  <h4 className="text-sm font-medium mb-2">
                    {t('SchedulerMgmt.section.params', '执行参数')}
                  </h4>
                  <pre className="rounded-md bg-muted p-3 text-xs whitespace-pre-wrap break-all">
                    {execDetail.paramsJson}
                  </pre>
                </div>
              )}

              {/* Output */}
              <div>
                <h4 className="text-sm font-medium mb-2">
                  {t('SchedulerMgmt.section.output', '执行输出')}
                </h4>
                <pre className="rounded-md bg-muted p-3 text-xs whitespace-pre-wrap break-all">
                  {execDetail.output || '-'}
                </pre>
              </div>

              {/* Error */}
              <div>
                <h4 className="text-sm font-medium mb-2">
                  {t('SchedulerMgmt.section.error', '错误信息')}
                </h4>
                <pre className="rounded-md bg-red-50 p-3 text-xs whitespace-pre-wrap break-all text-red-800">
                  {execDetail.errorMessage || '-'}
                </pre>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default SchedulerPage;
