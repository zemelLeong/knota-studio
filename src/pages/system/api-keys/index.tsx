import { useRequest } from 'ahooks';
import dayjs from 'dayjs';
import { useCallback, useMemo, useRef, useState } from 'react';
import type { ProTableColumnDef, ProTableRef } from '@/components/pro-table';
import { buildColumns, ProTable } from '@/components/pro-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useT } from '@/i18n';
import { useAuth } from '@/stores/auth';
import { toast } from '@/utils/toast';
import { useApiKeysAgent } from './agent';
import { ChangeRoleDialog } from './ChangeRoleDialog';
import { CreateExchangeTokenDialog } from './CreateExchangeTokenDialog';
import { EditApiKeyDialog } from './EditApiKeyDialog';
import type { ApiKeyResponse, CreateExchangeTokenResponse } from './options';
import {
  createApiKeyTableColumns,
  createExchangeTokenTableColumns,
  getApiKeys,
  getExchangeTokens,
  listRoles,
  revokeApiKey,
} from './options';
import { TokenResultDialog } from './TokenResultDialog';

const ApiKeysPage = () => {
  const t = useT();
  useApiKeysAgent();
  const { user } = useAuth();

  const [activeTab, setActiveTab] = useState<'keys' | 'tokens'>('keys');

  // Shared roles data for both dialogs
  const { data: rolesData, loading: rolesLoading } = useRequest(
    () => listRoles({ tenantCode: user?.tenantCode, page: 1, pageSize: 999 }),
    {
      ready: !!user?.tenantCode,
      refreshDeps: [user?.tenantCode],
    },
  );

  const roleOptions = (rolesData?.items ?? []).map((role) => ({
    value: role.id,
    label: role.name,
  }));

  // Edit API Key
  const [editApiKey, setEditApiKey] = useState<ApiKeyResponse | null>(null);
  const [editOpen, setEditOpen] = useState(false);

  // Change Role
  const [roleApiKey, setRoleApiKey] = useState<ApiKeyResponse | null>(null);
  const [roleOpen, setRoleOpen] = useState(false);

  // Create Exchange Token
  const [createTokenOpen, setCreateTokenOpen] = useState(false);

  // Token Result
  const [tokenResult, setTokenResult] =
    useState<CreateExchangeTokenResponse | null>(null);
  const [tokenResultOpen, setTokenResultOpen] = useState(false);

  const keysTableRef = useRef<ProTableRef>(null);
  const tokensTableRef = useRef<ProTableRef>(null);

  const handleKeysSuccess = useCallback(() => {
    keysTableRef.current?.refresh();
  }, []);

  const handleTokensSuccess = useCallback(() => {
    tokensTableRef.current?.refresh();
  }, []);

  const handleRevoke = useCallback(
    (record: ApiKeyResponse) => {
      void revokeApiKey(record.id).then(() => {
        toast.success(t('ApiKeyMgmt.toast.revoked', 'API Key 已吊销'));
        handleKeysSuccess();
      });
    },
    [handleKeysSuccess, t],
  );

  const handleTokenCreated = useCallback(
    (result: CreateExchangeTokenResponse) => {
      setTokenResult(result);
      setTokenResultOpen(true);
      handleTokensSuccess();
    },
    [handleTokensSuccess],
  );

  const apiKeyColumns = useMemo(
    () =>
      buildColumns<ApiKeyResponse>(createApiKeyTableColumns(t), {
        keyPrefix: ({ row }) => (
          <span className="font-mono text-sm">{row.original.keyPrefix}</span>
        ),
        status: ({ row }) => {
          const record = row.original;
          if (record.revokedAt) {
            return (
              <Badge variant="destructive">
                {t('ApiKeyMgmt.status.revoked', '已吊销')}
              </Badge>
            );
          }
          if (record.expiresAt && dayjs(record.expiresAt).isBefore(dayjs())) {
            return (
              <Badge variant="secondary">
                {t('ApiKeyMgmt.status.expired', '已过期')}
              </Badge>
            );
          }
          return (
            <Badge variant="default">
              {t('ApiKeyMgmt.status.active', '有效')}
            </Badge>
          );
        },
        lastUsedAt: ({ row }) => (
          <span className="text-sm">
            {row.original.lastUsedAt
              ? dayjs(row.original.lastUsedAt).format('YYYY-MM-DD HH:mm')
              : '—'}
          </span>
        ),
        expiresAt: ({ row }) => (
          <span className="text-sm">
            {row.original.expiresAt
              ? dayjs(row.original.expiresAt).format('YYYY-MM-DD HH:mm')
              : t('ApiKeyMgmt.status.neverExpire', '永不过期')}
          </span>
        ),
        createdAt: ({ row }) => (
          <span className="text-sm">
            {dayjs(row.original.createdAt).format('YYYY-MM-DD HH:mm')}
          </span>
        ),
        actions: ({ row }) => {
          const record = row.original;
          const isRevoked = !!record.revokedAt;
          return (
            <div className="inline-flex items-center gap-1">
              <Button
                variant="ghost"
                size="xs"
                disabled={isRevoked}
                onClick={() => {
                  setEditApiKey(record);
                  setEditOpen(true);
                }}
              >
                {t('ApiKeyMgmt.action.edit', '编辑 API Key')}
              </Button>
              <Button
                variant="ghost"
                size="xs"
                disabled={isRevoked}
                onClick={() => {
                  setRoleApiKey(record);
                  setRoleOpen(true);
                }}
              >
                {t('ApiKeyMgmt.action.changeRole', '换绑角色')}
              </Button>
              <Button
                variant="ghost"
                size="xs"
                disabled={isRevoked}
                className="text-destructive hover:text-destructive"
                onClick={() => handleRevoke(record)}
              >
                {t('ApiKeyMgmt.action.revoke', '吊销 API Key')}
              </Button>
            </div>
          );
        },
      }) as ProTableColumnDef<ApiKeyResponse>[],
    [handleRevoke, t],
  );

  const exchangeTokenColumns = useMemo(
    () =>
      buildColumns(createExchangeTokenTableColumns(t), {
        tokenPrefix: ({ row }) => (
          <span className="font-mono text-sm">{row.original.tokenPrefix}</span>
        ),
        usage: ({ row }) => (
          <span className="text-sm">
            {row.original.usedCount}/{row.original.maxUsage}
          </span>
        ),
        expiresAt: ({ row }) => (
          <span className="text-sm">
            {dayjs(row.original.expiresAt).format('YYYY-MM-DD HH:mm')}
          </span>
        ),
        createdAt: ({ row }) => (
          <span className="text-sm">
            {dayjs(row.original.createdAt).format('YYYY-MM-DD HH:mm')}
          </span>
        ),
      }) as ProTableColumnDef<import('@/api/api-keys').ExchangeTokenResponse>[],
    [t],
  );

  return (
    <div className="flex h-full flex-col gap-4">
      <Tabs
        className="min-h-0 flex-1"
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as 'keys' | 'tokens')}
      >
        <TabsList variant="line">
          <TabsTrigger value="keys">
            {t('ApiKeyMgmt.tab.keys', 'API 密钥')}
          </TabsTrigger>
          <TabsTrigger value="tokens">
            {t('ApiKeyMgmt.tab.tokens', '兑换令牌')}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="keys" className="overflow-hidden">
          <ProTable
            ref={keysTableRef}
            columns={apiKeyColumns}
            request={(params) =>
              getApiKeys({
                page: params.page,
                pageSize: params.pageSize,
              })
            }
            header={{
              title: t('ApiKeyMgmt.tab.keys', 'API 密钥'),
            }}
            search={false}
          />
        </TabsContent>

        <TabsContent value="tokens" className="overflow-hidden">
          <ProTable
            ref={tokensTableRef}
            columns={exchangeTokenColumns}
            request={(params) =>
              getExchangeTokens({
                page: params.page,
                pageSize: params.pageSize,
              })
            }
            header={{
              title: t('ApiKeyMgmt.tab.tokens', '兑换令牌'),
              toolbar: (
                <Button onClick={() => setCreateTokenOpen(true)}>
                  {t('ApiKeyMgmt.action.createToken', '创建兑换令牌')}
                </Button>
              ),
            }}
            search={false}
          />
        </TabsContent>
      </Tabs>

      <EditApiKeyDialog
        open={editOpen}
        apiKey={editApiKey}
        onOpenChange={(open) => {
          setEditOpen(open);
          if (!open) setEditApiKey(null);
        }}
        onSuccess={handleKeysSuccess}
      />

      <ChangeRoleDialog
        open={roleOpen}
        apiKey={roleApiKey}
        onOpenChange={(open) => {
          setRoleOpen(open);
          if (!open) setRoleApiKey(null);
        }}
        onSuccess={handleKeysSuccess}
        roleOptions={roleOptions}
        rolesLoading={rolesLoading}
      />

      <CreateExchangeTokenDialog
        open={createTokenOpen}
        onOpenChange={setCreateTokenOpen}
        onSuccess={handleTokenCreated}
        roleOptions={roleOptions}
      />

      <TokenResultDialog
        open={tokenResultOpen}
        result={tokenResult}
        onOpenChange={(open) => {
          setTokenResultOpen(open);
          if (!open) setTokenResult(null);
        }}
      />
    </div>
  );
};

export default ApiKeysPage;
