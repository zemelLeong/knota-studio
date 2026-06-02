import { useCallback, useMemo, useRef, useState } from 'react';
import type { ProTableColumnDef, ProTableRef } from '@/components/pro-table';
import { buildColumns, ProTable } from '@/components/pro-table';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { useT } from '@/i18n';
import type { RoleTemplateResponse } from '@/types/role-template';
import { toast } from '@/utils/toast';
import { AssignMenusDialog } from './AssignMenusDialog';
import { AssignPermissionsDialog } from './AssignPermissionsDialog';
import { useRoleTemplatesAgent } from './agent';
import {
  createRoleTemplateTableColumns,
  deleteRoleTemplate,
  listRoleTemplates,
} from './options';
import { RoleTemplateDialog } from './RoleTemplateDialog';

const RoleTemplatesPage = () => {
  // Register all page capabilities via the agent hook
  useRoleTemplatesAgent();

  const t = useT();

  const [createOpen, setCreateOpen] = useState(false);
  const [editTemplate, setEditTemplate] = useState<RoleTemplateResponse | null>(
    null,
  );
  const [assignMenusTemplate, setAssignMenusTemplate] =
    useState<RoleTemplateResponse | null>(null);
  const [assignPermsTemplate, setAssignPermsTemplate] =
    useState<RoleTemplateResponse | null>(null);
  const tableRef = useRef<ProTableRef>(null);

  const handleSuccess = useCallback(() => {
    tableRef.current?.refresh();
  }, []);

  const handleDelete = useCallback(
    (template: RoleTemplateResponse) => {
      void deleteRoleTemplate(template.id).then(() => {
        toast.success(t('RoleTemplateMgmt.toast.deleted', '角色模板删除成功'));
        handleSuccess();
      });
    },
    [handleSuccess, t],
  );

  const columns = useMemo(
    () =>
      buildColumns<RoleTemplateResponse>(createRoleTemplateTableColumns(t), {
        isDefault: ({ row }) => (
          <Switch checked={row.original.isDefault} disabled />
        ),
        actions: ({ row }) => {
          const template = row.original;
          return (
            <div className="inline-flex items-center gap-1">
              <Button
                variant="ghost"
                size="xs"
                onClick={() => setEditTemplate(template)}
              >
                {t('RoleTemplateMgmt.btn.edit', '编辑')}
              </Button>
              <Button
                variant="ghost"
                size="xs"
                className="text-destructive hover:text-destructive"
                onClick={() => handleDelete(template)}
              >
                {t('RoleTemplateMgmt.btn.delete', '删除')}
              </Button>
              <Button
                variant="ghost"
                size="xs"
                onClick={() => setAssignMenusTemplate(template)}
              >
                {t('RoleTemplateMgmt.btn.assignMenus', '分配菜单')}
              </Button>
              <Button
                variant="ghost"
                size="xs"
                onClick={() => setAssignPermsTemplate(template)}
              >
                {t('RoleTemplateMgmt.btn.assignPermissions', '分配权限')}
              </Button>
            </div>
          );
        },
      }) as ProTableColumnDef<RoleTemplateResponse>[],
    [handleDelete, t],
  );

  return (
    <>
      <ProTable
        ref={tableRef}
        columns={columns}
        request={() => listRoleTemplates()}
        header={{
          title: t('RoleTemplateMgmt.title', '角色模板管理'),
          toolbar: (
            <Button onClick={() => setCreateOpen(true)}>
              {t('RoleTemplateMgmt.btn.create', '新建模板')}
            </Button>
          ),
        }}
        search={false}
        pagination={false}
      />

      <RoleTemplateDialog
        open={createOpen || !!editTemplate}
        template={editTemplate}
        onOpenChange={(open) => {
          if (!open) {
            setCreateOpen(false);
            setEditTemplate(null);
          }
        }}
        onSuccess={() => {
          setCreateOpen(false);
          setEditTemplate(null);
          handleSuccess();
        }}
      />

      <AssignMenusDialog
        open={!!assignMenusTemplate}
        templateId={assignMenusTemplate?.id ?? null}
        templateName={assignMenusTemplate?.name ?? ''}
        onOpenChange={(open) => {
          if (!open) {
            setAssignMenusTemplate(null);
          }
        }}
        onSuccess={handleSuccess}
      />

      <AssignPermissionsDialog
        open={!!assignPermsTemplate}
        templateId={assignPermsTemplate?.id ?? null}
        templateName={assignPermsTemplate?.name ?? ''}
        onOpenChange={(open) => {
          if (!open) {
            setAssignPermsTemplate(null);
          }
        }}
        onSuccess={handleSuccess}
      />
    </>
  );
};

export default RoleTemplatesPage;
