import { get, post, put } from '@/api/client';
import type { PaginatedResponse } from '@/types/common';

// ─── Types ───────────────────────────────────────────────

export interface NotificationResponse {
  id: string;
  title: string;
  content: string;
  notificationType: string;
  priority: string;
  status: string;
  targetRoleCodes: string[] | null;
  createdAt: string;
}

export interface InboxItemResponse {
  id: string;
  notificationId: string;
  title: string;
  content: string;
  notificationType: string;
  priority: string;
  readAt: string | null;
  createdAt: string;
  senderName: string;
  senderTenantName: string;
}

export interface UnreadCountResponse {
  count: number;
  hasForced: boolean;
}

// ─── Management API ──────────────────────────────────────

export const createNotification = (data: {
  title: string;
  content: string;
  notificationType: string;
  priority?: string;
  targetRoleCodes?: string[];
}) => post<NotificationResponse>('/notifications', data);

export const listNotifications = (params: {
  page?: number;
  pageSize?: number;
  notificationType?: string;
}) =>
  get<PaginatedResponse<NotificationResponse>>('/notifications', { params });

export const revokeNotification = (id: string) =>
  put<{ success: boolean }>(`/notifications/${id}/revoke`, {});

// ─── Inbox API ───────────────────────────────────────────

export const getInbox = (params: {
  page?: number;
  pageSize?: number;
  read?: boolean;
}) =>
  get<PaginatedResponse<InboxItemResponse>>('/notifications/inbox', { params });

export const getUnreadCount = () =>
  get<UnreadCountResponse>('/notifications/unread-count', {
    throwError: true,
  });

export const markRead = (id: string) =>
  put<{ success: boolean }>(`/notifications/${id}/read`, {});

export const markAllRead = () =>
  put<{ success: boolean; count: number }>('/notifications/read-all', {});

export const getForcedNotifications = () =>
  get<InboxItemResponse[]>('/notifications/forced');
