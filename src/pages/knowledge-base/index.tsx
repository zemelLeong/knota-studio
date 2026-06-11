import { Icon } from '@iconify/react';
import { useRequest } from 'ahooks';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { useLocation, useNavigate } from 'react-router-dom';
import remarkGfm from 'remark-gfm';
import {
  buildColumns,
  ProTable,
  type ProTableColumnDef,
  type ProTableRef,
} from '@/components/pro-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
} from '@/components/ui/sidebar';
import { cn } from '@/lib/utils';
import { toast } from '@/utils/toast';
import {
  createDocument,
  createFolder,
  createLibrary,
  type DocumentPreview,
  deleteDocument,
  deleteFolder,
  getDocumentPreview,
  type KbDocument,
  type KbFolder,
  type KbLibrary,
  listDocuments,
  listFolders,
  listLibraries,
  presignDocumentAssets,
  reindexDocument,
  uploadFile,
} from './options';

type Selection =
  | { type: 'library'; libraryId: string; folderId?: undefined }
  | { type: 'folder'; libraryId: string; folderId: string };

type PreviewDocumentInput = Pick<KbDocument, 'id' | 'title'>;

interface PreviewLineTarget {
  startLine: number;
  endLine: number;
}

interface PreviewRequest {
  document: PreviewDocumentInput;
  lineTarget?: PreviewLineTarget | null;
}

interface PreviewResult {
  data: DocumentPreview;
  markdown: string;
  lineTarget: PreviewLineTarget | null;
}

const assetUrlPattern = /kb-asset:\/\/([^)]+)/g;

const mimeLabelMap: Record<string, string> = {
  'application/pdf': 'PDF',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    'DOCX',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation':
    'PPTX',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'XLSX',
  'text/markdown': 'Markdown',
  'text/plain': '纯文本',
  'image/png': 'PNG 图片',
  'image/jpeg': 'JPEG 图片',
  'image/webp': 'WEBP 图片',
  'image/bmp': 'BMP 图片',
  'image/tiff': 'TIFF 图片',
};

const supportedUploadExtensions = [
  '.pdf',
  '.docx',
  '.pptx',
  '.xlsx',
  '.md',
  '.markdown',
  '.txt',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.bmp',
  '.tif',
  '.tiff',
];

const supportedUploadAccept = [
  ...supportedUploadExtensions,
  ...Object.keys(mimeLabelMap),
].join(',');

const mimeByExtension: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  md: 'text/markdown',
  markdown: 'text/markdown',
  txt: 'text/plain',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  bmp: 'image/bmp',
  tif: 'image/tiff',
  tiff: 'image/tiff',
};

const mimeLabel = (mime?: string) =>
  mime ? (mimeLabelMap[mime] ?? mime) : '未知';

const inferSupportedUploadMime = (file: File) => {
  const extension = file.name.includes('.')
    ? file.name.split('.').pop()?.toLowerCase()
    : undefined;
  if (extension && mimeByExtension[extension]) {
    return mimeByExtension[extension];
  }
  return file.type && mimeLabelMap[file.type] ? file.type : null;
};

const extractQuotedField = (message: string, field: string) => {
  const match = new RegExp(`${field}='([^']*)'`).exec(message);
  return match?.[1];
};

const errorStageLabel = (message?: string | null) => {
  if (!message) return '未知阶段';
  if (
    message.includes('文件内容类型') ||
    message.includes('文件名后缀') ||
    message.includes('不支持的文件格式') ||
    message.includes('no parser found')
  ) {
    return '格式校验';
  }
  if (message.includes('MinerU returned HTTP') || message.includes('解析')) {
    return '文档解析';
  }
  if (message.includes('嵌入生成失败') || message.includes('embedding')) {
    return '向量生成';
  }
  if (message.includes('Qdrant') || message.includes('vector')) {
    return '向量写入';
  }
  if (message.includes('storage') || message.includes('S3')) {
    return '文件读取';
  }
  return '入库处理';
};

const formatErrorSummary = (message?: string | null) => {
  if (!message) return null;

  const detectedMime = extractQuotedField(message, 'detectedMime');
  const declaredMime = extractQuotedField(message, 'declaredMime');
  const extensionMime = extractQuotedField(message, 'extensionMime');
  const sourceName = extractQuotedField(message, 'sourceName');

  if (detectedMime && (declaredMime || extensionMime)) {
    return {
      stage: errorStageLabel(message),
      title: '文件类型不一致',
      description:
        '文件内容、上传声明或文件名后缀不一致。请确认文件没有被错误改名后重新上传。',
      details: [
        sourceName ? `文件名：${sourceName}` : undefined,
        `实际内容：${mimeLabel(detectedMime)}`,
        declaredMime ? `上传声明：${mimeLabel(declaredMime)}` : undefined,
        extensionMime ? `文件后缀：${mimeLabel(extensionMime)}` : undefined,
      ].filter(Boolean) as string[],
    };
  }

  if (message.includes('MinerU returned HTTP')) {
    return {
      stage: errorStageLabel(message),
      title: '文档解析服务返回错误',
      description:
        '解析服务未能处理该文件。请检查文件格式是否受支持，或查看原始错误定位解析服务返回内容。',
      details: [],
    };
  }

  if (message.includes('嵌入生成失败') || message.includes('embedding')) {
    return {
      stage: errorStageLabel(message),
      title: '向量生成失败',
      description: 'Embedding 服务不可用或请求失败，请检查向量模型服务状态。',
      details: [],
    };
  }

  return null;
};

const documentProgressLabel = (document: KbDocument) => {
  if (document.status === 'error' && document.indexingProgress?.label) {
    return `失败于：${document.indexingProgress.label}`;
  }
  if (document.status === 'indexing' && document.indexingProgress?.label) {
    return `入库中：${document.indexingProgress.label}`;
  }
  if (document.status === 'pending' && document.indexingProgress?.label) {
    return document.indexingProgress.label;
  }
  return null;
};

const documentProgressMessage = (document: KbDocument) => {
  if (!['pending', 'indexing', 'error'].includes(document.status)) {
    return statusMeta(document.status).description;
  }
  return (
    document.indexingProgress?.message ??
    documentProgressLabel(document) ??
    statusMeta(document.status).description
  );
};

const documentProgressPercent = (document: KbDocument) => {
  if (!['pending', 'indexing'].includes(document.status)) {
    return null;
  }
  const current = document.indexingProgress?.current;
  const total = document.indexingProgress?.total;
  if (typeof current !== 'number' || typeof total !== 'number' || total <= 0) {
    return null;
  }

  return Math.min(100, Math.max(0, Math.round((current / total) * 100)));
};

const statusVariant = (status: string) => {
  if (status === 'ready') return 'default';
  if (status === 'error') return 'destructive';
  return 'secondary';
};

const statusMeta = (status: string) => {
  switch (status) {
    case 'pending':
      return {
        icon: 'lucide:clock-3',
        label: '等待入库',
        description: '任务已创建，等待 worker 处理',
        tone: 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-300',
      };
    case 'indexing':
      return {
        icon: 'lucide:loader-2',
        label: '入库中',
        description: '正在解析、切分并写入向量索引',
        tone: 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
      };
    case 'ready':
      return {
        icon: 'lucide:check-circle-2',
        label: '可用',
        description: '文档已完成索引，可以检索和预览',
        tone: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
      };
    case 'error':
      return {
        icon: 'lucide:circle-alert',
        label: '失败',
        description: '入库失败，查看错误后可重新入库',
        tone: 'border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-300',
      };
    default:
      return {
        icon: 'lucide:circle-help',
        label: status,
        description: '未知状态',
        tone: 'border-border bg-muted/40 text-muted-foreground',
      };
  }
};

const replaceAssetUrls = (
  markdown: string,
  replacements: Map<string, string>,
) =>
  markdown.replace(
    assetUrlPattern,
    (_, key: string) => replacements.get(key) ?? `kb-asset://${key}`,
  );

const parsePositiveInt = (value: string | null) => {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};

const buildLineExcerpt = (
  markdown: string,
  target: PreviewLineTarget | null,
) => {
  if (!target) return [];
  const lines = markdown.split(/\r?\n/);
  const startLine = Math.max(1, target.startLine);
  const endLine = Math.max(startLine, target.endLine);
  const before = Math.max(1, startLine - 3);
  const after = Math.min(lines.length, endLine + 3);

  return lines.slice(before - 1, after).map((text, index) => {
    const lineNumber = before + index;
    return {
      lineNumber,
      text,
      active: lineNumber >= startLine && lineNumber <= endLine,
    };
  });
};

const KnowledgeBasePage = () => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const tableRef = useRef<ProTableRef>(null);
  const location = useLocation();
  const navigate = useNavigate();
  const [libraries, setLibraries] = useState<KbLibrary[]>([]);
  const [folders, setFolders] = useState<KbFolder[]>([]);
  const [documents, setDocuments] = useState<KbDocument[]>([]);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [libraryName, setLibraryName] = useState('');
  const [folderName, setFolderName] = useState('');
  const [previewRequest, setPreviewRequest] = useState<PreviewRequest | null>(
    null,
  );
  const [errorTarget, setErrorTarget] = useState<KbDocument | null>(null);
  const errorSummary = useMemo(
    () => formatErrorSummary(errorTarget?.errorMessage),
    [errorTarget?.errorMessage],
  );
  const [reindexingIds, setReindexingIds] = useState<Set<string>>(
    () => new Set(),
  );
  const handledPreviewQueryRef = useRef<string | null>(null);

  const previewQuery = useMemo(() => {
    const params = new URLSearchParams(location.search);
    const documentId = params.get('previewDocumentId');
    if (!documentId) return null;
    const startLine = parsePositiveInt(params.get('startLine'));
    const endLine = parsePositiveInt(params.get('endLine')) ?? startLine;
    return {
      documentId,
      startLine,
      endLine,
      key: `${documentId}:${startLine ?? ''}:${endLine ?? ''}`,
    };
  }, [location.search]);

  const clearPreviewQuery = useCallback(() => {
    if (!previewQuery) return;
    navigate('/knowledge-base', { replace: true });
  }, [navigate, previewQuery]);

  const folderChildren = useMemo(() => {
    const map = new Map<string, KbFolder[]>();
    for (const folder of folders) {
      const key = folder.parentId ?? 'root';
      const list = map.get(key) ?? [];
      list.push(folder);
      map.set(key, list);
    }
    return map;
  }, [folders]);

  const selectedLibrary = useMemo(
    () => libraries.find((item) => item.id === selection?.libraryId) ?? null,
    [libraries, selection?.libraryId],
  );

  const selectedFolder = useMemo(
    () => folders.find((item) => item.id === selection?.folderId) ?? null,
    [folders, selection?.folderId],
  );

  const loadLibraries = useCallback(async () => {
    const data = await listLibraries();
    setLibraries(data);
    setSelection((current) => {
      if (current && data.some((item) => item.id === current.libraryId)) {
        return current;
      }
      const first = data[0];
      if (!first) return null;
      return { type: 'library', libraryId: first.id };
    });
  }, []);

  const loadFolders = useCallback(async (libraryId: string) => {
    const roots = await listFolders({ libraryId });
    const all: KbFolder[] = [...roots];
    const queue = [...roots];
    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) continue;
      const children = await listFolders({
        libraryId,
        parentId: current.id,
      });
      all.push(...children);
      queue.push(...children);
    }
    setFolders(all);
  }, []);

  const hasIndexingDocuments = useMemo(
    () =>
      documents.some((document) =>
        ['pending', 'indexing'].includes(document.status),
      ),
    [documents],
  );

  const documentStats = useMemo(() => {
    const stats = {
      total: documents.length,
      pending: 0,
      indexing: 0,
      ready: 0,
      error: 0,
    };
    for (const document of documents) {
      if (document.status === 'pending') stats.pending += 1;
      if (document.status === 'indexing') stats.indexing += 1;
      if (document.status === 'ready') stats.ready += 1;
      if (document.status === 'error') stats.error += 1;
    }
    return stats;
  }, [documents]);

  const failedDocuments = useMemo(
    () => documents.filter((document) => document.status === 'error'),
    [documents],
  );
  const selectedLibraryId = selection?.libraryId;
  const selectedFolderId = selection?.folderId;
  const documentTableParams = useMemo(
    () => ({
      libraryId: selectedLibraryId,
      folderId: selectedFolderId,
    }),
    [selectedFolderId, selectedLibraryId],
  );

  const loadDocuments = useCallback(
    async (params: { page: number; pageSize: number }) => {
      if (!selection) {
        setDocuments([]);
        return {
          items: [],
          totalItems: 0,
          totalPages: 0,
          page: params.page,
          pageSize: params.pageSize,
        };
      }
      const data = await listDocuments({
        page: params.page,
        pageSize: params.pageSize,
        libraryId: selection.libraryId,
        folderId: selection.folderId,
      });
      setDocuments(data.items);
      return data;
    },
    [selection],
  );

  useEffect(() => {
    void loadLibraries();
  }, [loadLibraries]);

  useEffect(() => {
    if (!selection?.libraryId) {
      setFolders([]);
      return;
    }
    void loadFolders(selection.libraryId);
  }, [loadFolders, selection?.libraryId]);

  useEffect(() => {
    if (!hasIndexingDocuments) return;
    const timer = window.setInterval(() => {
      tableRef.current?.refresh({ silent: true });
    }, 3000);
    return () => window.clearInterval(timer);
  }, [hasIndexingDocuments]);

  const refreshAll = useCallback(async () => {
    await loadLibraries();
    if (selection?.libraryId) await loadFolders(selection.libraryId);
    tableRef.current?.refresh();
  }, [loadFolders, loadLibraries, selection?.libraryId]);

  const handleCreateLibrary = useCallback(async () => {
    const name = libraryName.trim();
    if (!name) return;
    const library = await createLibrary({ name });
    setLibraryName('');
    toast.success('知识库已创建');
    await loadLibraries();
    setSelection({ type: 'library', libraryId: library.id });
  }, [libraryName, loadLibraries]);

  const handleCreateFolder = useCallback(async () => {
    if (!selection) return;
    const name = folderName.trim();
    if (!name) return;
    await createFolder({
      libraryId: selection.libraryId,
      parentId: selection.folderId,
      name,
    });
    setFolderName('');
    toast.success('目录已创建');
    await loadFolders(selection.libraryId);
  }, [folderName, loadFolders, selection]);

  const { loading: uploading, runAsync: uploadDocuments } = useRequest(
    async (files: FileList) => {
      if (!selection) return;
      let createdCount = 0;
      let reusedCount = 0;
      for (const file of Array.from(files)) {
        const mimeType = inferSupportedUploadMime(file);
        if (!mimeType) {
          throw new Error(`不支持的文件格式：${file.name}`);
        }
        const uploaded = await uploadFile(file, {
          mimeTypeHint: mimeType,
        });
        const document = await createDocument({
          title: file.name,
          libraryId: selection.libraryId,
          folderId: selection.folderId,
          fileId: uploaded.id,
          sourceType: mimeType,
          scope: 'tenant',
        });
        if (document.reusedExisting) {
          reusedCount += 1;
        } else {
          createdCount += 1;
        }
      }
      return { createdCount, reusedCount };
    },
    {
      manual: true,
      onSuccess: (result) => {
        if (!result) return;
        if (result.createdCount > 0 && result.reusedCount > 0) {
          toast.success(
            `已提交 ${result.createdCount} 个入库任务，跳过 ${result.reusedCount} 个重复文档`,
          );
        } else if (result.createdCount > 0) {
          toast.success(`已提交 ${result.createdCount} 个入库任务`);
        } else if (result.reusedCount > 0) {
          toast.success(`已跳过 ${result.reusedCount} 个重复文档`);
        }
        tableRef.current?.refresh();
      },
      onError: (error) => {
        toast.assertNotApiError.error(
          error instanceof Error ? error.message : '上传入库失败',
        );
      },
      onFinally: () => {
        if (fileInputRef.current) fileInputRef.current.value = '';
      },
    },
  );

  const handleUpload = useCallback(
    (files: FileList | null) => {
      if (!selection || !files || files.length === 0) return;
      const unsupported = Array.from(files).filter(
        (file) => !inferSupportedUploadMime(file),
      );
      if (unsupported.length > 0) {
        toast.assertNotApiError.error(
          `不支持的文件格式：${unsupported[0]?.name ?? '未知文件'}`,
        );
        if (fileInputRef.current) fileInputRef.current.value = '';
        return;
      }
      void uploadDocuments(files);
    },
    [selection, uploadDocuments],
  );

  const {
    data: previewResult,
    loading: previewLoading,
    error: previewError,
  } = useRequest(
    async (): Promise<PreviewResult | null> => {
      if (!previewRequest) return null;
      const { document, lineTarget } = previewRequest;
      const data = await getDocumentPreview(document.id);
      let markdown = data.markdown;
      if (data.assets.length > 0) {
        const signed = await presignDocumentAssets(
          document.id,
          data.assets.map((asset) => asset.storageKey),
        );
        const replacements = new Map(
          signed.items.map((item) => [item.assetKey, item.url]),
        );
        markdown = replaceAssetUrls(data.markdown, replacements);
      }
      return {
        data,
        markdown,
        lineTarget: lineTarget ?? null,
      };
    },
    {
      ready: !!previewRequest,
      refreshDeps: [
        previewRequest?.document.id,
        previewRequest?.lineTarget?.startLine,
        previewRequest?.lineTarget?.endLine,
      ],
    },
  );

  const preview = previewRequest
    ? (previewResult?.data ?? previewRequest.document)
    : null;
  const previewMarkdown = previewRequest ? (previewResult?.markdown ?? '') : '';
  const previewLineTarget =
    (previewRequest ? previewResult?.lineTarget : null) ??
    previewRequest?.lineTarget ??
    null;
  const previewErrorMessage =
    previewError instanceof Error ? previewError.message : undefined;
  const previewLineExcerpt = useMemo(
    () => buildLineExcerpt(previewMarkdown, previewLineTarget),
    [previewLineTarget, previewMarkdown],
  );

  const openPreview = useCallback((request: PreviewRequest) => {
    setPreviewRequest(request);
  }, []);

  const handlePreview = useCallback(
    (document: KbDocument) => {
      clearPreviewQuery();
      openPreview({ document, lineTarget: null });
    },
    [clearPreviewQuery, openPreview],
  );

  useEffect(() => {
    if (!previewQuery) return;
    if (handledPreviewQueryRef.current === previewQuery.key) return;

    handledPreviewQueryRef.current = previewQuery.key;
    const lineTarget = previewQuery.startLine
      ? {
          startLine: previewQuery.startLine,
          endLine: previewQuery.endLine ?? previewQuery.startLine,
        }
      : null;
    openPreview({
      document: {
        id: previewQuery.documentId,
        title: '加载文档预览',
      },
      lineTarget,
    });
  }, [openPreview, previewQuery]);

  const handleDeleteDocument = useCallback(async (document: KbDocument) => {
    await deleteDocument(document.id);
    toast.success('文档已删除');
    tableRef.current?.refresh();
  }, []);

  const handleReindex = useCallback(async (document: KbDocument) => {
    setReindexingIds((current) => new Set(current).add(document.id));
    try {
      await reindexDocument(document.id);
      toast.success('已提交重新入库');
      tableRef.current?.refresh();
    } finally {
      setReindexingIds((current) => {
        const next = new Set(current);
        next.delete(document.id);
        return next;
      });
    }
  }, []);

  const documentColumns = useMemo(
    () =>
      buildColumns<KbDocument>(
        [
          {
            key: 'title',
            label: '文档',
            size: 420,
            minSize: 360,
            ellipsis: false,
            showOverflowTooltip: false,
          },
          {
            key: 'status',
            label: '状态',
            size: 120,
            align: 'center',
            ellipsis: false,
          },
          {
            key: 'chunkCount',
            label: '分块',
            size: 120,
            align: 'center',
            ellipsis: false,
          },
          {
            key: 'updatedAt',
            label: '更新时间',
            size: 180,
            align: 'center',
            ellipsis: false,
          },
          {
            key: 'actions',
            label: '操作',
            size: 290,
            align: 'center',
            ellipsis: false,
            enableResizing: false,
          },
        ],
        {
          title: ({ row }) => {
            const document = row.original;
            const progressPercent = documentProgressPercent(document);
            const isProcessing = ['pending', 'indexing'].includes(
              document.status,
            );
            return (
              <div className="min-w-0">
                <div className="truncate font-medium">{document.title}</div>
                <div className="mt-0.5 flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                  <span className="truncate">
                    {documentProgressMessage(document)}
                  </span>
                  {document.errorMessage && (
                    <button
                      type="button"
                      className="shrink-0 text-destructive underline-offset-2 hover:underline"
                      onClick={() => setErrorTarget(document)}
                    >
                      查看错误
                    </button>
                  )}
                </div>
                {progressPercent !== null && isProcessing && (
                  <div className="mt-1 flex items-center gap-2">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-blue-500 transition-all"
                        style={{ width: `${progressPercent}%` }}
                      />
                    </div>
                    <span className="w-10 text-right text-[11px] text-muted-foreground">
                      {progressPercent}%
                    </span>
                  </div>
                )}
              </div>
            );
          },
          status: ({ row }) => {
            const document = row.original;
            const meta = statusMeta(document.status);
            return (
              <Badge
                variant={statusVariant(document.status)}
                className={cn('border', meta.tone)}
              >
                <span className="inline-flex items-center gap-1">
                  <Icon
                    icon={meta.icon}
                    className={cn(
                      'size-3',
                      document.status === 'indexing' && 'animate-spin',
                    )}
                  />
                  {meta.label}
                </span>
              </Badge>
            );
          },
          chunkCount: ({ row }) => {
            const document = row.original;
            return (
              <div className="leading-tight">
                <div>{document.chunkCount}</div>
                {document.totalTokens > 0 && (
                  <div className="text-[11px] text-muted-foreground">
                    {document.totalTokens} tokens
                  </div>
                )}
              </div>
            );
          },
          updatedAt: ({ row }) =>
            new Date(row.original.updatedAt).toLocaleString(),
          actions: ({ row }) => {
            const document = row.original;
            const isProcessing = ['pending', 'indexing'].includes(
              document.status,
            );
            const isReindexing = reindexingIds.has(document.id);
            return (
              <div className="flex justify-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  disabled={document.status !== 'ready'}
                  onClick={() => void handlePreview(document)}
                >
                  预览
                </Button>
                {document.status === 'error' && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    onClick={() => setErrorTarget(document)}
                  >
                    错误
                  </Button>
                )}
                <Button
                  type="button"
                  variant={document.status === 'error' ? 'secondary' : 'ghost'}
                  size="xs"
                  disabled={isProcessing || isReindexing}
                  onClick={() => void handleReindex(document)}
                >
                  {isReindexing ? '提交中' : '重新入库'}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  disabled={isReindexing}
                  onClick={() => void handleDeleteDocument(document)}
                >
                  删除
                </Button>
              </div>
            );
          },
        },
      ) as ProTableColumnDef<KbDocument>[],
    [handleDeleteDocument, handlePreview, handleReindex, reindexingIds],
  );

  const renderFolders = (
    parentId: string | null,
    depth = 0,
  ): React.ReactNode => {
    const items = folderChildren.get(parentId ?? 'root') ?? [];
    return items.map((folder) => {
      const selected = selection?.folderId === folder.id;
      return (
        <SidebarMenuSubItem key={folder.id}>
          <SidebarMenuSubButton asChild isActive={selected}>
            <button
              type="button"
              className="w-full justify-start"
              style={depth > 0 ? { paddingLeft: 8 + depth * 12 } : undefined}
              onClick={() =>
                setSelection({
                  type: 'folder',
                  libraryId: folder.libraryId,
                  folderId: folder.id,
                })
              }
            >
              <Icon icon="lucide:folder" className="mr-2 size-4 shrink-0" />
              <span className="truncate">{folder.name}</span>
            </button>
          </SidebarMenuSubButton>
          <SidebarMenuAction
            type="button"
            showOnHover
            onClick={async () => {
              await deleteFolder(folder.id);
              toast.success('目录已删除');
              await loadFolders(folder.libraryId);
            }}
          >
            <Icon icon="lucide:trash-2" className="size-4" />
          </SidebarMenuAction>
          {folderChildren.has(folder.id) && (
            <SidebarMenuSub>
              {renderFolders(folder.id, depth + 1)}
            </SidebarMenuSub>
          )}
        </SidebarMenuSubItem>
      );
    });
  };

  return (
    <div className="flex h-full min-h-0 gap-4">
      <SidebarProvider defaultOpen className="h-full min-h-0 w-80 shrink-0">
        <Sidebar collapsible="none" className="w-full rounded-lg border">
          <SidebarHeader className="gap-3 p-4">
            <div className="flex items-center gap-2 text-base font-semibold">
              <Icon icon="lucide:library" className="size-4" />
              知识库
            </div>
            <div className="flex gap-2">
              <Input
                value={libraryName}
                placeholder="新建知识库"
                onChange={(event) => setLibraryName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void handleCreateLibrary();
                }}
              />
              <Button type="button" size="icon" onClick={handleCreateLibrary}>
                <Icon icon="lucide:plus" className="size-4" />
              </Button>
            </div>
          </SidebarHeader>
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupContent>
                <SidebarMenu>
                  {libraries.map((library) => {
                    const selected =
                      selection?.libraryId === library.id &&
                      !selection.folderId;
                    return (
                      <SidebarMenuItem key={library.id}>
                        <SidebarMenuButton
                          isActive={selected}
                          tooltip={library.name}
                          onClick={() =>
                            setSelection({
                              type: 'library',
                              libraryId: library.id,
                            })
                          }
                        >
                          <Icon
                            icon="lucide:library"
                            className="size-4 shrink-0"
                          />
                          <span>{library.name}</span>
                        </SidebarMenuButton>
                        {selection?.libraryId === library.id && (
                          <SidebarMenuSub>{renderFolders(null)}</SidebarMenuSub>
                        )}
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
        </Sidebar>
      </SidebarProvider>

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {!preview && (
          <Card className="flex min-h-0 flex-1 flex-col">
            <CardHeader className="shrink-0 pb-3">
              <CardTitle className="flex items-center justify-between gap-3 text-base">
                <span className="truncate">
                  {selectedFolder?.name ??
                    selectedLibrary?.name ??
                    '知识库文档'}
                </span>
                <div className="flex shrink-0 items-center gap-2">
                  <Input
                    value={folderName}
                    placeholder="新建目录"
                    className="h-9 w-40"
                    disabled={!selection}
                    onChange={(event) => setFolderName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') void handleCreateFolder();
                    }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!selection}
                    onClick={handleCreateFolder}
                  >
                    <Icon icon="lucide:folder-plus" className="mr-2 size-4" />
                    新建目录
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void refreshAll()}
                  >
                    <Icon
                      icon="lucide:refresh-cw"
                      className={
                        hasIndexingDocuments
                          ? 'mr-2 size-4 animate-spin'
                          : 'mr-2 size-4'
                      }
                    />
                    {hasIndexingDocuments ? '刷新中' : '刷新'}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    disabled={!selection || uploading}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Icon icon="lucide:upload" className="mr-2 size-4" />
                    上传入库
                  </Button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept={supportedUploadAccept}
                    multiple
                    className="hidden"
                    onChange={(event) => void handleUpload(event.target.files)}
                  />
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex min-h-0 flex-1 flex-col">
              <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1 rounded-md border bg-muted/40 px-2 py-1">
                  <Icon icon="lucide:files" className="size-3.5" />
                  当前页 {documentStats.total} 个
                </span>
                <span
                  className={cn(
                    'inline-flex items-center gap-1 rounded-md border px-2 py-1',
                    statusMeta('pending').tone,
                  )}
                >
                  <Icon icon="lucide:clock-3" className="size-3.5" />
                  等待 {documentStats.pending}
                </span>
                <span
                  className={cn(
                    'inline-flex items-center gap-1 rounded-md border px-2 py-1',
                    statusMeta('indexing').tone,
                  )}
                >
                  <Icon
                    icon="lucide:loader-2"
                    className={cn(
                      'size-3.5',
                      hasIndexingDocuments && 'animate-spin',
                    )}
                  />
                  入库中 {documentStats.indexing}
                </span>
                <span
                  className={cn(
                    'inline-flex items-center gap-1 rounded-md border px-2 py-1',
                    statusMeta('ready').tone,
                  )}
                >
                  <Icon icon="lucide:check-circle-2" className="size-3.5" />
                  可用 {documentStats.ready}
                </span>
                <span
                  className={cn(
                    'inline-flex items-center gap-1 rounded-md border px-2 py-1',
                    statusMeta('error').tone,
                  )}
                >
                  <Icon icon="lucide:circle-alert" className="size-3.5" />
                  失败 {documentStats.error}
                </span>
                {hasIndexingDocuments && (
                  <span className="text-[11px]">
                    检测到入库任务，页面会自动刷新状态
                  </span>
                )}
              </div>
              {failedDocuments.length > 0 && (
                <div className="mb-3 rounded-md border border-red-200 bg-red-50/70 p-3 dark:border-red-900/70 dark:bg-red-950/30">
                  <div className="mb-2 flex items-center gap-2 text-sm font-medium text-red-700 dark:text-red-300">
                    <Icon icon="lucide:circle-alert" className="size-4" />
                    {failedDocuments.length} 个文档入库失败
                  </div>
                  <div className="space-y-2">
                    {failedDocuments.slice(0, 3).map((document) => {
                      const summary = formatErrorSummary(document.errorMessage);
                      const stageLabel =
                        document.indexingProgress?.label ??
                        summary?.stage ??
                        errorStageLabel(document.errorMessage);
                      return (
                        <div
                          key={document.id}
                          className="flex items-start justify-between gap-3 rounded border bg-background/80 px-3 py-2"
                        >
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium">
                              {document.title}
                            </div>
                            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                              <span className="rounded bg-muted px-1.5 py-0.5">
                                {stageLabel}
                              </span>
                              <span className="max-w-[32rem] truncate">
                                {summary?.title ??
                                  document.errorMessage ??
                                  '入库失败'}
                              </span>
                            </div>
                          </div>
                          <div className="flex shrink-0 gap-1">
                            <Button
                              type="button"
                              variant="ghost"
                              size="xs"
                              onClick={() => setErrorTarget(document)}
                            >
                              详情
                            </Button>
                            <Button
                              type="button"
                              variant="secondary"
                              size="xs"
                              disabled={reindexingIds.has(document.id)}
                              onClick={() => void handleReindex(document)}
                            >
                              {reindexingIds.has(document.id)
                                ? '提交中'
                                : '重新入库'}
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {failedDocuments.length > 3 && (
                    <div className="mt-2 text-xs text-muted-foreground">
                      还有 {failedDocuments.length - 3}{' '}
                      个失败文档，请在列表中查看。
                    </div>
                  )}
                </div>
              )}
              <div className="min-h-0 flex-1">
                <ProTable<KbDocument>
                  ref={tableRef}
                  columns={documentColumns}
                  request={loadDocuments}
                  params={documentTableParams}
                  search={false}
                  refreshable
                  pagination={{
                    defaultPageSize: 30,
                    pageSizeOptions: [10, 20, 30, 50, 100],
                  }}
                />
              </div>
            </CardContent>
          </Card>
        )}

        {preview && (
          <Card className="flex min-h-0 flex-1 flex-col">
            <CardHeader className="shrink-0 pb-3">
              <CardTitle className="flex items-center justify-between gap-3 text-base">
                <span className="truncate">{preview.title}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => {
                    setPreviewRequest(null);
                    clearPreviewQuery();
                  }}
                >
                  <Icon icon="lucide:x" className="size-4" />
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex min-h-0 flex-1 flex-col">
              <Separator className="mb-4 shrink-0" />
              <div className="prose prose-sm min-h-0 max-w-none flex-1 overflow-y-auto dark:prose-invert">
                {previewLoading && <p>加载中</p>}
                {previewErrorMessage && (
                  <p className="text-destructive">{previewErrorMessage}</p>
                )}
                {!previewLoading && !previewErrorMessage && (
                  <>
                    {previewLineTarget && (
                      <div className="not-prose mb-4 rounded-md border border-teal-200 bg-teal-50/80 p-3 text-xs dark:border-teal-800 dark:bg-teal-950/30">
                        <div className="mb-2 flex items-center gap-2 font-medium text-teal-800 dark:text-teal-200">
                          <Icon icon="lucide:map-pin" className="size-3.5" />
                          定位到第 {previewLineTarget.startLine}
                          {previewLineTarget.endLine !==
                          previewLineTarget.startLine
                            ? `-${previewLineTarget.endLine}`
                            : ''}{' '}
                          行
                        </div>
                        <div className="max-h-64 overflow-y-auto rounded border bg-background font-mono text-[11px] leading-relaxed">
                          {previewLineExcerpt.length > 0 ? (
                            previewLineExcerpt.map((line) => (
                              <div
                                key={line.lineNumber}
                                className={cn(
                                  'grid grid-cols-[3rem_1fr] gap-3 px-2 py-0.5',
                                  line.active &&
                                    'bg-amber-100 text-amber-950 dark:bg-amber-500/20 dark:text-amber-100',
                                )}
                              >
                                <span className="select-none text-right text-muted-foreground">
                                  {line.lineNumber}
                                </span>
                                <span className="whitespace-pre-wrap break-words">
                                  {line.text || ' '}
                                </span>
                              </div>
                            ))
                          ) : (
                            <div className="px-3 py-2 text-muted-foreground">
                              未找到对应行内容
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                    <div className="overflow-x-auto [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:px-3 [&_td]:py-2 [&_th]:border [&_th]:px-3 [&_th]:py-2 [&_th]:text-left">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {previewMarkdown}
                      </ReactMarkdown>
                    </div>
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        )}
      </main>

      <Dialog
        open={!!errorTarget}
        onOpenChange={(open) => {
          if (!open) setErrorTarget(null);
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{errorTarget?.title ?? '错误详情'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {errorTarget?.indexingProgress && (
              <div className="rounded-md border bg-muted/30 p-3 text-sm">
                <div className="font-medium">
                  失败阶段：{errorTarget.indexingProgress.label}
                </div>
                {errorTarget.indexingProgress.message && (
                  <div className="mt-1 text-muted-foreground">
                    {errorTarget.indexingProgress.message}
                  </div>
                )}
                {errorTarget.indexingProgress.stageStartedAt && (
                  <div className="mt-1 text-xs text-muted-foreground">
                    阶段开始：
                    {new Date(
                      errorTarget.indexingProgress.stageStartedAt,
                    ).toLocaleString()}
                  </div>
                )}
              </div>
            )}
            {errorSummary && (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
                <div className="text-sm font-medium text-destructive">
                  {errorSummary.title}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {errorSummary.description}
                </p>
                {errorSummary.details.length > 0 && (
                  <div className="mt-3 space-y-1 text-sm text-foreground">
                    {errorSummary.details.map((detail) => (
                      <div key={detail}>{detail}</div>
                    ))}
                  </div>
                )}
              </div>
            )}
            <pre className="max-h-[38vh] overflow-auto whitespace-pre-wrap rounded-md border bg-muted/40 p-3 text-sm text-destructive">
              {errorTarget?.errorMessage}
            </pre>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default KnowledgeBasePage;
