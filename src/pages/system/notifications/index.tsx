import { useCallback, useMemo, useRef, useState } from 'react';
import type { ProTableColumnDef, ProTableRef } from '@/components/pro-table';
import { buildColumns, ProTable } from '@/components/pro-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useT } from '@/i18n';
import { cn } from '@/lib/utils';
import { toast } from '@/utils/toast';
import { useNotificationAgent } from './agent';
import { CreateNotificationDialog } from './CreateNotificationDialog';
import type { InboxItemResponse, NotificationResponse } from './options';
import {
  createInboxColumns,
  createManageColumns,
  getInbox,
  listNotifications,
  markAllRead,
  markRead,
  revokeNotification,
} from './options';

type TabValue = 'inbox' | 'manage';

// biome-ignore lint/style/useNamingConvention: maps backend snake_case values
const TYPE_VARIANTS: Record<
  string,
  { variant: 'default' | 'secondary' | 'outline' }
> = {
  platform: { variant: 'secondary' },
  // biome-ignore lint/style/useNamingConvention: backend value
  tenant_all: { variant: 'default' },
  // biome-ignore lint/style/useNamingConvention: backend value
  tenant_role: { variant: 'outline' },
};

const NotificationsPage = () => {
  useNotificationAgent();
  const t = useT();

  const [activeTab, setActiveTab] = useState<TabValue>('inbox');

  // Inbox state
  const inboxTableRef = useRef<ProTableRef>(null);
  const [expandedInboxId, setExpandedInboxId] = useState<string | null>(null);

  // Manage state
  const manageTableRef = useRef<ProTableRef>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);

  const handleInboxRefresh = useCallback(() => {
    inboxTableRef.current?.refresh();
  }, []);

  const handleManageRefresh = useCallback(() => {
    manageTableRef.current?.refresh();
  }, []);

  // ── Type badge helper ──────────────────────────────────────────
  const typeMap = useMemo<
    Record<
      string,
      { label: string; variant: 'default' | 'secondary' | 'outline' }
    >
  >(
    () => ({
      platform: {
        label: t('NotificationMgmt.type.platform', '平台通知'),
        variant: TYPE_VARIANTS.platform.variant,
      },
      // biome-ignore lint/style/useNamingConvention: backend value
      tenant_all: {
        label: t('NotificationMgmt.type.tenantAll', '全员通知'),
        variant: TYPE_VARIANTS.tenant_all.variant,
      },
      // biome-ignore lint/style/useNamingConvention: backend value
      tenant_role: {
        label: t('NotificationMgmt.type.tenantRole', '角色通知'),
        variant: TYPE_VARIANTS.tenant_role.variant,
      },
    }),
    [t],
  );

  // ── Inbox row click handler ────────────────────────────────────
  const handleInboxRowClick = useCallback(
    (item: InboxItemResponse) => {
      setExpandedInboxId((prev) => (prev === item.id ? null : item.id));
      if (!item.readAt) {
        void markRead(item.id).then(() => {
          handleInboxRefresh();
        });
      }
    },
    [handleInboxRefresh],
  );

  // ── Mark all read handler ──────────────────────────────────────
  const handleMarkAllRead = useCallback(() => {
    void markAllRead().then(() => {
      toast.success(
        t('NotificationMgmt.toast.allMarkedRead', '已全部标为已读'),
      );
      handleInboxRefresh();
    });
  }, [handleInboxRefresh, t]);

  // ── Inbox columns ──────────────────────────────────────────────
  const inboxColumns = useMemo(
    () =>
      buildColumns<InboxItemResponse>(createInboxColumns(t), {
        title: ({ row }) => {
          const item = row.original;
          const isExpanded = expandedInboxId === item.id;
          const isRead = !!item.readAt;
          return (
            <div className="flex flex-col gap-1">
              <button
                type="button"
                className={cn(
                  'cursor-pointer text-left',
                  !isRead && 'font-semibold',
                  isRead && 'opacity-65',
                )}
                onClick={() => handleInboxRowClick(item)}
              >
                {isExpanded ? '▾ ' : '▸ '}
                {item.title}
              </button>
              {isExpanded && (
                <div
                  className={cn(
                    'whitespace-pre-wrap rounded-md bg-muted/50 px-3 py-2 text-sm text-muted-foreground',
                    isRead && 'opacity-65',
                  )}
                >
                  {item.content}
                </div>
              )}
            </div>
          );
        },
        notificationType: ({ row }) => {
          const info = typeMap[row.original.notificationType];
          const isRead = !!row.original.readAt;
          return (
            <span className={cn(isRead && 'opacity-65')}>
              {info ? (
                <Badge variant={info.variant}>{info.label}</Badge>
              ) : (
                <span>{row.original.notificationType}</span>
              )}
            </span>
          );
        },
        priority: ({ row }) => {
          const isRead = !!row.original.readAt;
          return (
            <span className={cn(isRead && 'opacity-65')}>
              {row.original.priority === 'high' ? (
                <Badge variant="destructive">
                  {t('NotificationMgmt.priority.high', '紧急')}
                </Badge>
              ) : (
                <Badge variant="secondary">
                  {t('NotificationMgmt.priority.normal', '普通')}
                </Badge>
              )}
            </span>
          );
        },
        senderName: ({ row }) => {
          const isRead = !!row.original.readAt;
          return (
            <span className={cn(isRead && 'opacity-65')}>
              {row.original.senderName}
            </span>
          );
        },
        senderTenantName: ({ row }) => {
          const isRead = !!row.original.readAt;
          return (
            <span className={cn(isRead && 'opacity-65')}>
              {row.original.senderTenantName}
            </span>
          );
        },
        readAt: ({ row }) =>
          row.original.readAt ? (
            <Badge variant="secondary">
              {t('NotificationMgmt.inbox.read', '已读')}
            </Badge>
          ) : (
            <Badge variant="default">
              {t('NotificationMgmt.inbox.unread', '未读')}
            </Badge>
          ),
        createdAt: ({ row }) => {
          const isRead = !!row.original.readAt;
          return (
            <span className={cn(isRead && 'opacity-65')}>
              {row.original.createdAt}
            </span>
          );
        },
      }) as ProTableColumnDef<InboxItemResponse>[],
    [t, typeMap, expandedInboxId, handleInboxRowClick],
  );

  // ── Manage columns ─────────────────────────────────────────────
  const manageColumns = useMemo(
    () =>
      buildColumns<NotificationResponse>(createManageColumns(t), {
        notificationType: ({ row }) => {
          const info = typeMap[row.original.notificationType];
          return info ? (
            <Badge variant={info.variant}>{info.label}</Badge>
          ) : (
            <span>{row.original.notificationType}</span>
          );
        },
        priority: ({ row }) =>
          row.original.priority === 'high' ? (
            <Badge variant="destructive">
              {t('NotificationMgmt.priority.high', '紧急')}
            </Badge>
          ) : (
            <Badge variant="secondary">
              {t('NotificationMgmt.priority.normal', '普通')}
            </Badge>
          ),
        status: ({ row }) =>
          row.original.status === 'active' ? (
            <Badge variant="default">
              {t('NotificationMgmt.manage.statusActive', '有效')}
            </Badge>
          ) : (
            <Badge variant="secondary">
              {t('NotificationMgmt.manage.statusRevoked', '已撤回')}
            </Badge>
          ),
        actions: ({ row }) => {
          const notification = row.original;
          const isActive = notification.status === 'active';
          return (
            <div className="inline-flex items-center gap-1">
              {isActive && (
                <Button
                  variant="ghost"
                  size="xs"
                  className="text-destructive hover:text-destructive"
                  onClick={() => {
                    void revokeNotification(notification.id).then(() => {
                      toast.success(
                        t('NotificationMgmt.toast.revoked', '通知已撤回'),
                      );
                      handleManageRefresh();
                    });
                  }}
                >
                  {t('NotificationMgmt.manage.action.revoke', '撤回')}
                </Button>
              )}
            </div>
          );
        },
      }) as ProTableColumnDef<NotificationResponse>[],
    [t, typeMap, handleManageRefresh],
  );

  return (
    <div className="flex h-full flex-col gap-4">
      <Tabs
        className="min-h-0 flex-1"
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as TabValue)}
      >
        <TabsList variant="line">
          <TabsTrigger value="inbox">
            {t('NotificationMgmt.tab.inbox', '收件箱')}
          </TabsTrigger>
          <TabsTrigger value="manage">
            {t('NotificationMgmt.tab.manage', '通知管理')}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="inbox" className="overflow-hidden">
          <ProTable
            ref={inboxTableRef}
            columns={inboxColumns}
            request={(params) =>
              getInbox({
                page: params.page as number,
                pageSize: params.pageSize as number,
              })
            }
            header={{
              title: t('NotificationMgmt.tab.inbox', '收件箱'),
              toolbar: (
                <Button onClick={handleMarkAllRead}>
                  {t('NotificationMgmt.inbox.action.markAllRead', '全部已读')}
                </Button>
              ),
            }}
            search={false}
          />
        </TabsContent>

        <TabsContent value="manage" className="overflow-hidden">
          <ProTable
            ref={manageTableRef}
            columns={manageColumns}
            request={(params) =>
              listNotifications({
                page: params.page as number,
                pageSize: params.pageSize as number,
                notificationType: params.notificationType as string | undefined,
              })
            }
            header={{
              title: t('NotificationMgmt.tab.manage', '通知管理'),
              toolbar: (
                <Button onClick={() => setCreateDialogOpen(true)}>
                  {t('NotificationMgmt.manage.action.create', '发送通知')}
                </Button>
              ),
            }}
            search={false}
          />
        </TabsContent>
      </Tabs>

      <CreateNotificationDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        onSuccess={handleManageRefresh}
      />
    </div>
  );
};

export default NotificationsPage;
