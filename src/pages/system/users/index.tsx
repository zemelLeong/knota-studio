import { useCallback, useMemo, useRef, useState } from 'react';
import type { ProTableColumnDef, ProTableRef } from '@/components/pro-table';
import { buildColumns, ProTable } from '@/components/pro-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { useT } from '@/i18n';
import { useAuth } from '@/stores/auth';
import type { UserResponse } from '@/types/user';
import { toast } from '@/utils/toast';
import { useUsersAgent } from './agent';
import {
  createUserTableColumns,
  listUsers,
  toggleUserStatus,
  unlockAccount,
} from './options';
import { ResetPasswordDialog } from './ResetPasswordDialog';
import { RoleAssignDialog } from './RoleAssignDialog';
import { SuperAdminDialog } from './SuperAdminDialog';
import { UserDialog } from './UserDialog';

const UsersPage = () => {
  const t = useT();
  const { user: currentUser } = useAuth();
  const isSuperAdmin = currentUser?.isSuperAdmin ?? false;

  // Register all page capabilities via the agent hook
  useUsersAgent();

  const [createOpen, setCreateOpen] = useState(false);
  const [editUser, setEditUser] = useState<UserResponse | null>(null);
  const [resetPwdUser, setResetPwdUser] = useState<UserResponse | null>(null);
  const [roleUser, setRoleUser] = useState<UserResponse | null>(null);
  const [superAdminOpen, setSuperAdminOpen] = useState(false);
  const tableRef = useRef<ProTableRef>(null);

  const handleSuccess = useCallback(() => {
    tableRef.current?.refresh();
  }, []);

  const handleToggleStatus = useCallback(
    (user: UserResponse, status: 'active' | 'disabled') => {
      const isSelf = user.id === currentUser?.id;
      if (isSelf) {
        toast.assertNotApiError.error(
          t('UserMgmt.toast.cannotModifySelf', '不能修改自己的状态'),
        );
        return;
      }
      void toggleUserStatus(user.id, { status }).then(() => {
        toast.success(t('UserMgmt.toast.statusUpdated', '状态更新成功'));
        handleSuccess();
      });
    },
    [currentUser?.id, handleSuccess, t],
  );

  const handleUnlock = useCallback(
    (user: UserResponse) => {
      void unlockAccount(user.email).then(() => {
        toast.success(t('UserMgmt.toast.unlocked', '已解锁'));
        handleSuccess();
      });
    },
    [handleSuccess, t],
  );

  const columns = useMemo(
    () =>
      buildColumns<UserResponse>(createUserTableColumns(t), {
        roles: () => <span className="text-sm text-muted-foreground">—</span>,
        status: ({ row }) => {
          const user = row.original;
          const isSelf = user.id === currentUser?.id;
          const isActive = user.status === 'active';
          return (
            <div className="inline-flex items-center gap-2">
              <Switch
                checked={isActive}
                disabled={isSelf}
                onCheckedChange={(checked) => {
                  handleToggleStatus(user, checked ? 'active' : 'disabled');
                }}
              />
              <span className="text-sm">
                {isActive
                  ? t('UserMgmt.badge.enabled', '启用')
                  : t('UserMgmt.badge.disabled', '禁用')}
              </span>
            </div>
          );
        },
        locked: ({ row }) => {
          const user = row.original;
          return user.isLocked ? (
            <Badge variant="destructive">
              {t('UserMgmt.badge.locked', '已锁定')}
            </Badge>
          ) : (
            <Badge variant="secondary">
              {t('UserMgmt.badge.normal', '正常')}
            </Badge>
          );
        },
        actions: ({ row }) => {
          const user = row.original;
          return (
            <div className="inline-flex items-center gap-1">
              <Button
                variant="ghost"
                size="xs"
                onClick={() => setEditUser(user)}
              >
                {t('UserMgmt.btn.edit', '编辑')}
              </Button>
              <Button
                variant="ghost"
                size="xs"
                onClick={() => setResetPwdUser(user)}
              >
                {t('UserMgmt.btn.resetPassword', '重置密码')}
              </Button>
              <Button
                variant="ghost"
                size="xs"
                onClick={() => setRoleUser(user)}
              >
                {t('UserMgmt.btn.assignRole', '分配角色')}
              </Button>
              {isSuperAdmin && user.isLocked && (
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => handleUnlock(user)}
                >
                  {t('UserMgmt.btn.unlock', '解锁')}
                </Button>
              )}
            </div>
          );
        },
      }) as ProTableColumnDef<UserResponse>[],
    [currentUser?.id, isSuperAdmin, handleToggleStatus, handleUnlock, t],
  );

  return (
    <>
      <ProTable
        ref={tableRef}
        columns={columns}
        request={(params) =>
          listUsers({
            page: params.page as number,
            pageSize: params.pageSize as number,
            name: params.name as string | undefined,
            email: params.email as string | undefined,
            status: params.status as string | undefined,
          })
        }
        header={{
          title: t('UserMgmt.title', '用户管理'),
          toolbar: (
            <>
              <Button onClick={() => setCreateOpen(true)}>
                {t('UserMgmt.btn.createUser', '新建用户')}
              </Button>
              {isSuperAdmin && (
                <Button
                  variant="outline"
                  onClick={() => setSuperAdminOpen(true)}
                >
                  {t('UserMgmt.btn.createSuperAdmin', '创建超级管理员')}
                </Button>
              )}
            </>
          ),
        }}
        search={{ defaultCollapsed: false }}
        initialColumnPinning={{ left: ['name', 'email'], right: ['actions'] }}
      />

      <UserDialog
        open={createOpen || !!editUser}
        user={editUser}
        onOpenChange={(open) => {
          if (!open) {
            setCreateOpen(false);
            setEditUser(null);
          }
        }}
        onSuccess={() => {
          setCreateOpen(false);
          setEditUser(null);
          handleSuccess();
        }}
      />

      <ResetPasswordDialog
        open={!!resetPwdUser}
        user={resetPwdUser}
        onOpenChange={(open) => {
          if (!open) setResetPwdUser(null);
        }}
        onSuccess={handleSuccess}
      />

      <RoleAssignDialog
        open={!!roleUser}
        user={roleUser}
        onOpenChange={(open) => {
          if (!open) setRoleUser(null);
        }}
        onSuccess={handleSuccess}
      />

      <SuperAdminDialog
        open={superAdminOpen}
        onOpenChange={setSuperAdminOpen}
        onSuccess={handleSuccess}
      />
    </>
  );
};

export default UsersPage;
