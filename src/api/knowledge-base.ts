import type { PageContextMinimal, ToolDefinition } from '@/lib/agent';
import type { PaginatedResponse } from '@/types/common';
import { del, fetchSSE, get, getBlob, post, put } from './client';

// ---- QA Types ----

export interface QaRequest {
  instruction: string;
  material?: {
    inline?: string;
    documentIds?: string[];
    fileIds?: string[];
  };
  /** Session ID — omitted on first request, server creates a new session. */
  sessionId?: string;
  /** Frontend page tools available for this request. */
  pageTools?: ToolDefinition[];
  /** Minimal page context for AI understanding. */
  pageContext?: PageContextMinimal[];
}

export interface QaCitation {
  documentId: string;
  chunkId?: string;
  content: string;
  score: number;
}

// ---- Library / Folder / Document Types ----

export interface KbLibrary {
  id: string;
  name: string;
  description?: string | null;
  sortOrder: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface KbFolder {
  id: string;
  libraryId: string;
  parentId?: string | null;
  name: string;
  path: string;
  depth: number;
  sortOrder: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface KbDocument {
  id: string;
  title: string;
  description?: string | null;
  libraryId?: string | null;
  folderId?: string | null;
  sourceType: string;
  scope: string;
  fileId?: string | null;
  status: string;
  chunkCount: number;
  totalTokens: number;
  errorMessage?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateLibraryRequest {
  name: string;
  description?: string | null;
  sortOrder?: number;
}

export interface CreateFolderRequest {
  libraryId: string;
  parentId?: string | null;
  name: string;
  sortOrder?: number;
}

export interface CreateDocumentRequest {
  title: string;
  description?: string | null;
  libraryId?: string | null;
  folderId?: string | null;
  sourceType?: string;
  scope?: string;
  fileId?: string;
  content?: string;
}

export interface DocumentListParams {
  page?: number;
  pageSize?: number;
  libraryId?: string;
  folderId?: string;
  status?: string;
  scope?: string;
}

export const listLibraries = () => get<KbLibrary[]>('/kb-libraries');

export const createLibrary = (data: CreateLibraryRequest) =>
  post<KbLibrary>('/kb-libraries', data);

export const updateLibrary = (id: string, data: CreateLibraryRequest) =>
  put<KbLibrary>(`/kb-libraries/${id}`, data);

export const deleteLibrary = (id: string) => del(`/kb-libraries/${id}`);

export const listFolders = (params: {
  libraryId: string;
  parentId?: string | null;
}) => get<KbFolder[]>('/kb-folders', { params });

export const createFolder = (data: CreateFolderRequest) =>
  post<KbFolder>('/kb-folders', data);

export const updateFolder = (
  id: string,
  data: Omit<CreateFolderRequest, 'libraryId'>,
) => put<KbFolder>(`/kb-folders/${id}`, data);

export const deleteFolder = (id: string) => del(`/kb-folders/${id}`);

export const listDocuments = (params: DocumentListParams) =>
  get<PaginatedResponse<KbDocument>>('/kb-documents', { params });

export const createDocument = (data: CreateDocumentRequest) =>
  post<KbDocument>('/kb-documents', data);

export const deleteDocument = (id: string) => del(`/kb-documents/${id}`);

export const reindexDocument = (id: string) =>
  post<{ success: boolean }>(`/kb-documents/${id}/reindex`, {});

// ---- Document Preview Types ----

export interface DocumentAsset {
  id: string;
  name: string;
  mimeType: string;
  storageKey: string;
  size: number;
}

export interface DocumentPreview {
  documentId: string;
  title: string;
  markdown: string;
  assets: DocumentAsset[];
}

export interface PresignedDocumentAsset {
  assetKey: string;
  url: string;
  expiresIn: number;
}

export interface PresignDocumentAssetsResponse {
  items: PresignedDocumentAsset[];
}

export const getDocumentPreview = (id: string) =>
  get<DocumentPreview>(`/kb/documents/${id}/preview`);

export const presignDocumentAssets = (id: string, assetKeys: string[]) =>
  post<PresignDocumentAssetsResponse>(`/kb/documents/${id}/assets/presign`, {
    assetKeys,
  });

// ---- Streaming QA Types ----

export type QaPhase =
  | {
      type: 'MaterialProcessing';
      detail: { strategy: string; totalChunks: number | null };
    }
  | { type: 'GeneratingAnswer' }
  | { type: 'Persisting' };

export interface QaStreamResponse {
  answer: string;
  citations: QaCitation[];
  intent: string;
  outputFormat: string;
  strategy: string;
  mode: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  sessionId: string;
}

export type QaStreamEvent =
  | { type: 'Started'; data: { sessionId: string } }
  | { type: 'PhaseChanged'; data: { phase: QaPhase } }
  | {
      type: 'ToolCallStarted';
      data: {
        toolName: string;
        toolCallId: string;
        arguments: Record<string, unknown>;
      };
    }
  | {
      type: 'ToolCallCompleted';
      data: {
        toolName: string;
        toolCallId: string;
        resultPreview: string;
        resultFull?: string;
        durationMs: number;
      };
    }
  | { type: 'AnswerToken'; data: { token: string } }
  | { type: 'Completed'; data: { response: QaStreamResponse } }
  | { type: 'Error'; data: { message: string } };

/**
 * Stream a QA request via SSE. Parses each `data:` line into a
 * `QaStreamEvent` and invokes `onEvent` for every event received.
 * Supports cancellation through an optional `AbortSignal`.
 */
export const askQuestionStream = async (
  request: QaRequest,
  onEvent: (event: QaStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> => {
  const response = await fetchSSE('/kb/qa/v3/stream', request, signal);
  const reader = response.body?.getReader();
  if (!reader) return;

  const decoder = new TextDecoder();
  let buffer = '';

  const readChunk = async (): Promise<string | null> => {
    const { done, value } = await reader.read();
    if (done) return null;
    return decoder.decode(value, { stream: true });
  };

  let chunk = await readChunk();
  while (chunk !== null) {
    buffer += chunk;

    const parts = buffer.split('\n\n');
    buffer = parts.pop() ?? '';

    for (const part of parts) {
      const trimmedPart = part.trim();
      if (!trimmedPart) continue;

      for (const line of trimmedPart.split('\n')) {
        if (line.startsWith(':')) continue;
        if (!line.startsWith('data:')) continue;

        const jsonStr = line.slice(5).trim();
        if (!jsonStr) continue;

        const event: QaStreamEvent = JSON.parse(jsonStr);
        onEvent(event);
      }
    }

    chunk = await readChunk();
  }

  reader.releaseLock();
};

export const exportSession = (id: string): Promise<Blob> =>
  getBlob(`/chat/sessions/${id}/export`);

export const debugExportSession = (id: string): Promise<Blob> =>
  getBlob(`/chat/sessions/${id}/debug-export`);

// ---- Content Part Types (from tokenUsage.contentParts) ----

export interface ContentPartToolCall {
  type: 'tool_call';
  toolName: string;
  toolCallId: string;
  arguments?: Record<string, unknown>;
  resultPreview: string;
  resultFull?: string;
  durationMs: number;
  createdAt: string;
}

export interface ContentPartText {
  type: 'text';
  content: string;
  createdAt: string;
}

export type ContentPart = ContentPartToolCall | ContentPartText;

interface MaterialRefInline {
  type: 'inline';
  id: string;
  name: string;
  content: string;
}

interface TokenUsage {
  contentParts?: ContentPart[];
}

// ---- Chat Session Types ----

export interface ChatSession {
  id: string;
  title?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  materialRefs?: { inline?: MaterialRefInline } | null;
  tokenUsage?: TokenUsage | null;
  createdAt: string;
}

export interface ChatSessionDetail extends ChatSession {
  messages: ChatMessage[];
}

export const createChatSession = () => post<ChatSession>('/chat/sessions', {});

export const listChatSessions = () => get<ChatSession[]>('/chat/sessions');

export const getChatSession = (id: string) =>
  get<ChatSessionDetail>(`/chat/sessions/${id}`);

export const deleteChatSession = (id: string) => del(`/chat/sessions/${id}`);

// ---- Tool Result ----

export interface ToolResultRequest {
  toolCallId: string;
  status: 'success' | 'error';
  output?: Record<string, unknown>;
  error?: string;
}

export const postToolResult = (result: ToolResultRequest) =>
  post<{ ok: boolean }>('/kb/qa/v3/tool-result', result);
