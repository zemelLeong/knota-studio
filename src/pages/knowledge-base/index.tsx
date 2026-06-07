import { Icon } from '@iconify/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
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

const assetUrlPattern = /kb-asset:\/\/([^)]+)/g;

const statusVariant = (status: string) => {
  if (status === 'ready') return 'default';
  if (status === 'error') return 'destructive';
  return 'secondary';
};

const replaceAssetUrls = (
  markdown: string,
  replacements: Map<string, string>,
) =>
  markdown.replace(
    assetUrlPattern,
    (_, key: string) => replacements.get(key) ?? `kb-asset://${key}`,
  );

const KnowledgeBasePage = () => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [libraries, setLibraries] = useState<KbLibrary[]>([]);
  const [folders, setFolders] = useState<KbFolder[]>([]);
  const [documents, setDocuments] = useState<KbDocument[]>([]);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [libraryName, setLibraryName] = useState('');
  const [folderName, setFolderName] = useState('');
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<DocumentPreview | null>(null);
  const [previewMarkdown, setPreviewMarkdown] = useState('');

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

  const loadDocuments = useCallback(async () => {
    if (!selection) {
      setDocuments([]);
      return;
    }
    setLoading(true);
    try {
      const data = await listDocuments({
        page: 1,
        pageSize: 100,
        libraryId: selection.libraryId,
        folderId: selection.folderId,
      });
      setDocuments(data.items);
    } finally {
      setLoading(false);
    }
  }, [selection]);

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
    void loadDocuments();
  }, [loadDocuments]);

  const refreshAll = useCallback(async () => {
    await loadLibraries();
    if (selection?.libraryId) await loadFolders(selection.libraryId);
    await loadDocuments();
  }, [loadDocuments, loadFolders, loadLibraries, selection?.libraryId]);

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

  const handleUpload = useCallback(
    async (files: FileList | null) => {
      if (!selection || !files || files.length === 0) return;
      setUploading(true);
      try {
        for (const file of Array.from(files)) {
          const uploaded = await uploadFile(file, {
            mimeTypeHint: file.type || undefined,
          });
          await createDocument({
            title: file.name,
            libraryId: selection.libraryId,
            folderId: selection.folderId,
            fileId: uploaded.id,
            scope: 'tenant',
          });
        }
        toast.success('已提交入库任务');
        await loadDocuments();
      } finally {
        setUploading(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    },
    [loadDocuments, selection],
  );

  const handlePreview = useCallback(async (document: KbDocument) => {
    const data = await getDocumentPreview(document.id);
    setPreview(data);
    if (data.assets.length === 0) {
      setPreviewMarkdown(data.markdown);
      return;
    }
    const signed = await presignDocumentAssets(
      document.id,
      data.assets.map((asset) => asset.storageKey),
    );
    const replacements = new Map(
      signed.items.map((item) => [item.assetKey, item.url]),
    );
    setPreviewMarkdown(replaceAssetUrls(data.markdown, replacements));
  }, []);

  const handleDeleteDocument = useCallback(
    async (document: KbDocument) => {
      await deleteDocument(document.id);
      toast.success('文档已删除');
      await loadDocuments();
    },
    [loadDocuments],
  );

  const handleReindex = useCallback(
    async (document: KbDocument) => {
      await reindexDocument(document.id);
      toast.success('已提交重建索引');
      await loadDocuments();
    },
    [loadDocuments],
  );

  const renderFolders = (
    parentId: string | null,
    depth = 0,
  ): React.ReactNode => {
    const items = folderChildren.get(parentId ?? 'root') ?? [];
    return items.map((folder) => {
      const selected = selection?.folderId === folder.id;
      return (
        <div key={folder.id}>
          <div
            className="flex items-center gap-1"
            style={{ paddingLeft: `${depth * 16}px` }}
          >
            <Button
              type="button"
              variant={selected ? 'secondary' : 'ghost'}
              size="sm"
              className="min-w-0 flex-1 justify-start"
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
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={async () => {
                await deleteFolder(folder.id);
                toast.success('目录已删除');
                await loadFolders(folder.libraryId);
              }}
            >
              <Icon icon="lucide:trash-2" className="size-4" />
            </Button>
          </div>
          {renderFolders(folder.id, depth + 1)}
        </div>
      );
    });
  };

  return (
    <div className="flex h-full min-h-0 gap-4 p-4">
      <aside className="flex w-80 shrink-0 flex-col gap-4">
        <Card className="min-h-0 flex-1">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Icon icon="lucide:library" className="size-4" />
              知识库
            </CardTitle>
          </CardHeader>
          <CardContent className="flex min-h-0 flex-col gap-3">
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
            <div className="min-h-0 flex-1 overflow-y-auto">
              {libraries.map((library) => {
                const selected =
                  selection?.libraryId === library.id && !selection.folderId;
                return (
                  <div key={library.id} className="mb-1">
                    <Button
                      type="button"
                      variant={selected ? 'secondary' : 'ghost'}
                      size="sm"
                      className="w-full justify-start"
                      onClick={() =>
                        setSelection({
                          type: 'library',
                          libraryId: library.id,
                        })
                      }
                    >
                      <Icon
                        icon="lucide:library"
                        className="mr-2 size-4 shrink-0"
                      />
                      <span className="truncate">{library.name}</span>
                    </Button>
                    {selection?.libraryId === library.id && renderFolders(null)}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center justify-between gap-3 text-base">
              <span className="truncate">
                {selectedFolder?.name ?? selectedLibrary?.name ?? '知识库文档'}
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
                  <Icon icon="lucide:refresh-cw" className="mr-2 size-4" />
                  刷新
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
                  multiple
                  className="hidden"
                  onChange={(event) => void handleUpload(event.target.files)}
                />
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-hidden rounded-md border">
              <table className="w-full table-fixed text-sm">
                <thead className="bg-muted/60 text-left">
                  <tr>
                    <th className="w-[36%] px-3 py-2 font-medium">文档</th>
                    <th className="w-28 px-3 py-2 font-medium">状态</th>
                    <th className="w-28 px-3 py-2 font-medium">分块</th>
                    <th className="w-44 px-3 py-2 font-medium">更新时间</th>
                    <th className="w-72 px-3 py-2 text-right font-medium">
                      操作
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {documents.map((document) => (
                    <tr key={document.id} className="border-t">
                      <td className="min-w-0 px-3 py-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <Icon
                            icon="lucide:file-text"
                            className="size-4 shrink-0 text-muted-foreground"
                          />
                          <div className="min-w-0">
                            <div className="truncate font-medium">
                              {document.title}
                            </div>
                            {document.errorMessage && (
                              <div className="truncate text-xs text-destructive">
                                {document.errorMessage}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <Badge variant={statusVariant(document.status)}>
                          {document.status}
                        </Badge>
                      </td>
                      <td className="px-3 py-2">{document.chunkCount}</td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {new Date(document.updatedAt).toLocaleString()}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex justify-end gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="xs"
                            onClick={() => void handlePreview(document)}
                          >
                            预览
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="xs"
                            onClick={() => void handleReindex(document)}
                          >
                            重建索引
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="xs"
                            onClick={() => void handleDeleteDocument(document)}
                          >
                            删除
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {documents.length === 0 && (
                    <tr>
                      <td
                        colSpan={5}
                        className="px-3 py-10 text-center text-muted-foreground"
                      >
                        {loading ? '加载中' : '暂无文档'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {preview && (
          <Card className="min-h-0 flex-1">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{preview.title}</CardTitle>
            </CardHeader>
            <CardContent className="min-h-0">
              <Separator className="mb-4" />
              <div className="prose prose-sm max-h-[48vh] max-w-none overflow-y-auto dark:prose-invert">
                <ReactMarkdown>{previewMarkdown}</ReactMarkdown>
              </div>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
};

export default KnowledgeBasePage;
