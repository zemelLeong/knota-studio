import { Icon } from '@iconify/react';
import { useRequest } from 'ahooks';
import { useMemo, useRef, useState } from 'react';
import type { ProTableColumnDef } from '@/components/pro-table';
import { buildColumns, ProTable } from '@/components/pro-table';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useT } from '@/i18n';
import { useAuth } from '@/stores/auth';
import type { TenantResponse } from '@/types/user';
import { formatBytes } from '@/utils/format';
import { toast } from '@/utils/toast';
import { useUploader } from '@/utils/uploader';
import { useFileAgent } from './agent';
import type {
  FileReferenceWithFileResponse,
  FileRefsSysScope,
} from './options';
import {
  createFileColumns,
  detachFileReference,
  type FilesSysScope,
  fetchFileContent,
  getAllTenants,
  getPreviewUrl,
  listFileReferences,
  triggerDownload,
} from './options';

// ─── Preview Dialog ──────────────────────────────────

const previewableTextTypes = new Set([
  'text/plain',
  'text/csv',
  'text/markdown',
  'application/json',
  'text/javascript',
  'application/javascript',
  'text/html',
  'text/css',
  'text/xml',
  'application/xml',
  'text/yaml',
  'application/x-yaml',
]);

const previewableImagePrefixes = ['image/'];

const previewablePdfType = 'application/pdf';

const isPreviewable = (mimeType: string, size: number): boolean => {
  const previewLimit = 20 * 1024 * 1024;
  if (size > previewLimit) return false;
  return (
    previewableTextTypes.has(mimeType) ||
    mimeType === previewablePdfType ||
    previewableImagePrefixes.some((prefix) => mimeType.startsWith(prefix))
  );
};

const isTextType = (mimeType: string): boolean =>
  previewableTextTypes.has(mimeType);

const isImageType = (mimeType: string): boolean =>
  previewableImagePrefixes.some((prefix) => mimeType.startsWith(prefix));

const isPdfType = (mimeType: string): boolean =>
  mimeType === previewablePdfType;

type PreviewData =
  | { kind: 'text'; content: string }
  | { kind: 'image'; url: string }
  | { kind: 'pdf'; url: string };

const PreviewDialog = ({
  data,
  open,
  onOpenChange,
}: {
  data: {
    file: { id: string; name: string; mimeType: string };
    sys?: FilesSysScope;
  } | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) => {
  const t = useT();
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const loadPreview = useMemo(() => {
    if (!data || !open) return null;
    const { file, sys } = data;

    return () => {
      setPreview(null);
      setPreviewError(null);

      if (isTextType(file.mimeType)) {
        fetchFileContent(file.id, sys)
          .then(async (blob) => {
            const text = await blob.text();
            setPreview({ kind: 'text', content: text });
          })
          .catch((err: unknown) => {
            setPreviewError(err instanceof Error ? err.message : String(err));
          });
      } else if (isImageType(file.mimeType) || isPdfType(file.mimeType)) {
        getPreviewUrl(file.id, sys)
          .then((resp) => {
            const kind = isPdfType(file.mimeType) ? 'pdf' : 'image';
            setPreview({ kind, url: resp.url } as PreviewData);
          })
          .catch((err: unknown) => {
            setPreviewError(err instanceof Error ? err.message : String(err));
          });
      }
    };
  }, [data, open]);

  if (loadPreview && open && !preview && !previewError) {
    loadPreview();
  }

  const renderPreview = () => {
    if (previewError) {
      return (
        <p className="text-sm text-destructive">
          {t('FileMgmt.previewError', '预览失败：{{error}}', {
            error: previewError,
          })}
        </p>
      );
    }

    if (!preview) {
      return (
        <div className="flex items-center justify-center py-8">
          <Icon
            icon="lucide:loader-2"
            className="size-6 animate-spin text-muted-foreground"
          />
        </div>
      );
    }

    if (preview.kind === 'text') {
      return (
        <pre className="max-h-96 overflow-auto rounded-md bg-muted p-4 text-xs">
          {preview.content}
        </pre>
      );
    }

    if (preview.kind === 'image') {
      return (
        <div className="flex max-h-96 items-center justify-center overflow-auto">
          <img
            src={preview.url}
            alt={data?.file.name ?? ''}
            className="max-h-96 max-w-full object-contain"
          />
        </div>
      );
    }

    if (preview.kind === 'pdf') {
      return (
        <iframe
          src={preview.url}
          className="h-96 w-full rounded-md border"
          title={data?.file.name ?? 'PDF Preview'}
        />
      );
    }

    return null;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {t('FileMgmt.previewTitle', '文件预览')} — {data?.file.name}
          </DialogTitle>
          <DialogDescription>{data?.file.mimeType}</DialogDescription>
        </DialogHeader>
        {renderPreview()}
      </DialogContent>
    </Dialog>
  );
};

// ─── Upload Progress Dialog ──────────────────────────

const UploadProgressDialog = ({
  items,
  open,
  onOpenChange,
}: {
  items: Record<string, import('@/utils/uploader').UploadingItem>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) => {
  const t = useT();
  const itemList = Object.values(items);

  const phaseLabel = (phase: string): string => {
    const map: Record<string, string> = {
      'hashing-fast': t('FileMgmt.phaseHashingFast', '计算快速哈希...'),
      probing: t('FileMgmt.phaseProbing', '探测秒传...'),
      'hashing-full': t('FileMgmt.phaseHashingFull', '计算完整哈希...'),
      'instant-confirming': t('FileMgmt.phaseInstantConfirming', '确认秒传...'),
      'small-uploading': t('FileMgmt.phaseSmallUploading', '上传中...'),
      initiating: t('FileMgmt.phaseInitiating', '初始化上传...'),
      'uploading-parts': t('FileMgmt.phaseUploadingParts', '上传分片...'),
      completing: t('FileMgmt.phaseCompleting', '完成上传...'),
      done: t('FileMgmt.phaseDone', '上传完成'),
      error: t('FileMgmt.phaseError', '上传失败'),
    };
    return map[phase] ?? phase;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('FileMgmt.uploadProgress', '上传进度')}</DialogTitle>
          <DialogDescription>
            {t('FileMgmt.uploadProgressDesc', '{{count}} 个文件正在上传', {
              count: itemList.length,
            })}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {itemList.map((item) => {
            const totalBytes = item.size || 1;
            const progressPercent = Math.round(
              ((item.bytesUploaded || item.hashLoaded || 0) / totalBytes) * 100,
            );
            const isDone = item.phase === 'done';
            const isError = item.phase === 'error';
            let barColor = 'accent-primary';
            if (isError) {
              barColor = 'accent-destructive';
            } else if (isDone) {
              barColor = 'accent-green-500';
            }

            return (
              <div key={item.uid} className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="truncate font-medium">{item.name}</span>
                  <span className="shrink-0 text-muted-foreground">
                    {formatBytes(item.size)}
                  </span>
                </div>
                <progress
                  className={`h-2 w-full ${barColor}`}
                  value={progressPercent}
                  max={100}
                />
                <div className="text-xs text-muted-foreground">
                  {phaseLabel(item.phase)}
                  {item.partsTotal > 0 && item.phase === 'uploading-parts'
                    ? ` (${item.partsDone}/${item.partsTotal})`
                    : ''}
                </div>
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
};

// ─── Confirm Detach Dialog ───────────────────────────

const ConfirmDialog = ({
  title,
  description,
  open,
  onOpenChange,
  onConfirm,
  loading,
}: {
  title: string;
  description: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  loading: boolean;
}) => {
  const t = useT();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            {t('Common.cancel', '取消')}
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={loading}>
            {loading && (
              <Icon
                icon="lucide:loader-2"
                className="mr-1 size-4 animate-spin"
              />
            )}
            {t('Common.confirm', '确认')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

// ─── Page ────────────────────────────────────────────

const FilesPage = () => {
  const t = useT();
  const { user } = useAuth();
  const isSuperAdmin = user?.isSuperAdmin ?? false;

  // Tenant selector state (super-admin only)
  const [selectedTenantCode, setSelectedTenantCode] = useState<string>('');
  const tableRef = useRef<{ reload: () => void } | null>(null);

  const { data: tenantsData } = useRequest(
    () => (isSuperAdmin ? getAllTenants() : Promise.resolve(null)),
    { ready: isSuperAdmin },
  );
  const tenants: TenantResponse[] = tenantsData?.items ?? [];

  // Derive sys scopes
  const refsSys: FileRefsSysScope | undefined = useMemo(
    () =>
      isSuperAdmin && selectedTenantCode
        ? { tenantCode: selectedTenantCode }
        : undefined,
    [isSuperAdmin, selectedTenantCode],
  );

  const selectedTenant = useMemo(
    () =>
      isSuperAdmin && selectedTenantCode
        ? (tenants.find((t) => t.code === selectedTenantCode) ?? null)
        : null,
    [isSuperAdmin, selectedTenantCode, tenants],
  );

  const filesSys: FilesSysScope | undefined = useMemo(
    () =>
      isSuperAdmin && selectedTenant
        ? { tenantCode: selectedTenant.code, tenantId: selectedTenant.id }
        : undefined,
    [isSuperAdmin, selectedTenant],
  );

  useFileAgent({ refsSys, filesSys });

  // Upload hook
  const { upload, uploadingItems } = useUploader({
    bizType: 'system',
    bizId: 'attachment',
    sys: filesSys,
    onSuccess: () => {
      tableRef.current?.reload();
    },
  });

  const hasUploadingItems = Object.keys(uploadingItems).length > 0;

  // Preview state
  const [previewTarget, setPreviewTarget] = useState<{
    id: string;
    name: string;
    mimeType: string;
  } | null>(null);

  // Detach confirm state
  const [detachTarget, setDetachTarget] =
    useState<FileReferenceWithFileResponse | null>(null);

  const detachRequest = useRequest(detachFileReference, {
    manual: true,
    onSuccess: () => {
      toast.success(t('FileMgmt.detachSuccess', '引用已解除'));
      setDetachTarget(null);
      tableRef.current?.reload();
    },
  });

  // Table columns
  const fileColumns = useMemo(() => createFileColumns(t), [t]);

  const columns = useMemo(
    () =>
      buildColumns<FileReferenceWithFileResponse>(fileColumns, {
        resourceType: ({ row }) => row.original.resourceType,
        resourceId: ({ row }) => (
          <span className="font-mono text-xs">{row.original.resourceId}</span>
        ),
        'file.name': ({ row }) =>
          row.original.file?.name ?? row.original.displayName ?? '-',
        'file.size': ({ row }) =>
          row.original.file ? formatBytes(row.original.file.size) : '-',
        'file.mimeType': ({ row }) => row.original.file?.mimeType ?? '-',
        createdAt: ({ row }) => {
          const val = row.original.createdAt;
          return val ? new Date(val).toLocaleString() : '-';
        },
        details: ({ row }) => {
          const ref = row.original;
          const file = ref.file;
          const canPreview = file && isPreviewable(file.mimeType, file.size);

          return (
            <div className="flex items-center justify-center gap-1">
              <Button
                variant="ghost"
                size="xs"
                disabled={!file}
                onClick={() => {
                  if (file) {
                    triggerDownload(file.id, file.name, filesSys).catch(
                      (err: unknown) => {
                        toast.assertNotApiError.error(
                          t('FileMgmt.downloadError', '下载失败：{{error}}', {
                            error:
                              err instanceof Error ? err.message : String(err),
                          }),
                        );
                      },
                    );
                  }
                }}
              >
                <Icon icon="lucide:download" className="mr-1 size-3.5" />
                {t('FileMgmt.download', '下载')}
              </Button>
              {canPreview && (
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => {
                    if (file) {
                      setPreviewTarget({
                        id: file.id,
                        name: file.name,
                        mimeType: file.mimeType,
                      });
                    }
                  }}
                >
                  <Icon icon="lucide:eye" className="mr-1 size-3.5" />
                  {t('FileMgmt.preview', '预览')}
                </Button>
              )}
              <Button
                variant="ghost"
                size="xs"
                className="text-destructive hover:text-destructive"
                onClick={() => setDetachTarget(ref)}
              >
                <Icon icon="lucide:unlink" className="mr-1 size-3.5" />
                {t('FileMgmt.detach', '解除')}
              </Button>
            </div>
          );
        },
      }) as ProTableColumnDef<FileReferenceWithFileResponse>[],
    [fileColumns, filesSys, t],
  );

  // Upload handler
  const handleUploadOne = (file: File) => {
    void upload(file);
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    Array.from(files).forEach((f) => {
      handleUploadOne(f);
    });
    e.target.value = '';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const files = e.dataTransfer.files;
    Array.from(files).forEach((f) => {
      handleUploadOne(f);
    });
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  // Super-admin tenant gate
  const tenantSelected = !isSuperAdmin || Boolean(selectedTenantCode);
  const uploadDisabled = !tenantSelected;

  return (
    <>
      <div className="flex h-full flex-col gap-4">
        {/* Tenant selector for super-admin */}
        {isSuperAdmin && (
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium">
              {t('FileMgmt.selectTenant', '选择租户')}:
            </span>
            <Select
              value={selectedTenantCode}
              onValueChange={setSelectedTenantCode}
            >
              <SelectTrigger className="w-64">
                <SelectValue
                  placeholder={t(
                    'FileMgmt.selectTenantPlaceholder',
                    '请选择租户',
                  )}
                />
              </SelectTrigger>
              <SelectContent>
                {tenants.map((tenant) => (
                  <SelectItem key={tenant.id} value={tenant.code}>
                    {tenant.name} ({tenant.code})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Main table */}
        {tenantSelected ? (
          <ProTable
            columns={columns}
            request={(params) =>
              listFileReferences(
                {
                  page: params.page,
                  pageSize: params.pageSize,
                  resourceType: params.resourceType as string | undefined,
                },
                refsSys,
              )
            }
            header={{
              title: t('FileMgmt.title', '文件管理'),
              toolbar: (
                <div className="flex items-center gap-2">
                  <Button asChild disabled={uploadDisabled}>
                    <label className="cursor-pointer">
                      <Icon icon="lucide:upload" className="mr-1.5 size-4" />
                      {t('FileMgmt.upload', '上传文件')}
                      <input
                        type="file"
                        className="hidden"
                        multiple
                        onChange={handleFileInput}
                        disabled={uploadDisabled}
                      />
                    </label>
                  </Button>
                </div>
              ),
            }}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center text-muted-foreground">
            {t('FileMgmt.pleaseSelectTenant', '请先选择租户以查看文件')}
          </div>
        )}

        {/* Drag-and-drop zone */}
        {tenantSelected && (
          <section
            aria-label={t('FileMgmt.dragDropHint', '拖拽文件到此处上传')}
            className="flex h-24 items-center justify-center rounded-lg border-2 border-dashed border-muted-foreground/25 text-sm text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary"
            onDrop={handleDrop}
            onDragOver={handleDragOver}
          >
            <Icon icon="lucide:cloud-upload" className="mr-2 size-5" />
            {t('FileMgmt.dragDropHint', '拖拽文件到此处上传')}
          </section>
        )}
      </div>

      {/* Upload progress dialog */}
      <UploadProgressDialog
        items={uploadingItems}
        open={hasUploadingItems}
        onOpenChange={() => {}}
      />

      {/* Preview dialog */}
      <PreviewDialog
        data={
          previewTarget
            ? {
                file: previewTarget,
                sys: filesSys,
              }
            : null
        }
        open={!!previewTarget}
        onOpenChange={(open) => {
          if (!open) setPreviewTarget(null);
        }}
      />

      {/* Detach confirm dialog */}
      <ConfirmDialog
        title={t('FileMgmt.detachTitle', '解除文件引用')}
        description={t(
          'FileMgmt.detachConfirm',
          '确定要解除该文件引用吗？此操作不可撤销。',
        )}
        open={!!detachTarget}
        onOpenChange={(open) => {
          if (!open) setDetachTarget(null);
        }}
        onConfirm={() => {
          if (detachTarget) {
            detachRequest.run(detachTarget.id, refsSys);
          }
        }}
        loading={detachRequest.loading}
      />
    </>
  );
};

export default FilesPage;
