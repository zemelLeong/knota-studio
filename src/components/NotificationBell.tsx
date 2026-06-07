import { Icon } from '@iconify/react';
import { useRequest } from 'ahooks';
import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import * as api from '@/api/notifications';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';
import { useT } from '@/i18n';
import { cn } from '@/lib/utils';

const pollIntervalMs = 30_000;
const previewCount = 5;

const isGatewayTimeout = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'status' in error &&
  (error as { status?: unknown }).status === 504;

const NotificationBell = () => {
  const t = useT();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [unreadPollingStopped, setUnreadPollingStopped] = useState(false);

  const { data: unreadResult, refresh: refreshCount } = useRequest(
    api.getUnreadCount,
    {
      cacheKey: 'notification-unread-count',
      ready: !unreadPollingStopped,
      pollingInterval: unreadPollingStopped ? undefined : pollIntervalMs,
      cacheTime: pollIntervalMs * 2,
      onError: (error) => {
        if (isGatewayTimeout(error)) {
          setUnreadPollingStopped(true);
        }
      },
    },
  );
  const unreadCount = unreadResult?.count ?? 0;

  const { data: inboxResult, refresh: refreshPreview } = useRequest(
    () => api.getInbox({ page: 1, pageSize: previewCount }),
    { manual: true },
  );
  const previewItems = inboxResult?.items ?? [];

  const handleOpenChange = useCallback(
    (newOpen: boolean) => {
      setOpen(newOpen);
      if (newOpen) {
        refreshPreview();
      }
    },
    [refreshPreview],
  );

  const handleMarkAllRead = useCallback(async () => {
    await api.markAllRead();
    if (!unreadPollingStopped) {
      refreshCount();
    }
    toast.success(t('Notification.Bell.allMarkedRead', '已全部标为已读'));
  }, [refreshCount, t, unreadPollingStopped]);

  const handleClickItem = useCallback(
    (item: api.InboxItemResponse) => {
      if (!item.readAt) {
        void api.markRead(item.id).then(() => {
          if (!unreadPollingStopped) {
            refreshCount();
          }
        });
      }
      setOpen(false);
      navigate('/system/notifications');
    },
    [navigate, refreshCount, unreadPollingStopped],
  );

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <Icon icon="lucide:bell" className="size-4" />
          {unreadCount > 0 && (
            <Badge
              variant="destructive"
              className="absolute -right-1 -top-1 flex size-4 items-center justify-center p-0 text-[10px]"
            >
              {unreadCount > 99 ? '99+' : unreadCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3">
          <span className="text-sm font-semibold">
            {t('Notification.Bell.title', '通知')}
          </span>
          {unreadCount > 0 && (
            <Button
              variant="ghost"
              size="xs"
              onClick={() => void handleMarkAllRead()}
            >
              {t('Notification.Bell.markAllRead', '全部已读')}
            </Button>
          )}
        </div>
        <Separator />

        {/* List */}
        <div className="max-h-96 overflow-y-auto">
          {previewItems.length === 0 ? (
            <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
              {t('Notification.Bell.noNotifications', '暂无通知')}
            </div>
          ) : (
            previewItems.map((item) => (
              <button
                key={item.id}
                type="button"
                className={cn(
                  'flex w-full flex-col gap-1 px-4 py-3 text-left transition-colors hover:bg-accent',
                  !item.readAt && 'bg-primary/5',
                )}
                onClick={() => handleClickItem(item)}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      'flex-1 truncate text-sm',
                      !item.readAt ? 'font-semibold' : 'text-muted-foreground',
                    )}
                  >
                    {item.title}
                  </span>
                  {item.priority === 'high' && (
                    <Badge
                      variant="destructive"
                      className="shrink-0 text-[10px]"
                    >
                      {t('Notification.Bell.urgent', '紧急')}
                    </Badge>
                  )}
                </div>
                <span className="text-xs text-muted-foreground">
                  {item.createdAt}
                </span>
              </button>
            ))
          )}
        </div>

        {/* Footer */}
        <Separator />
        <div className="px-4 py-2">
          <Button
            variant="ghost"
            size="sm"
            className="w-full"
            onClick={() => {
              setOpen(false);
              navigate('/system/notifications');
            }}
          >
            {t('Notification.Bell.viewAll', '查看全部')}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
};

export default NotificationBell;
