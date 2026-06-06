import type { PageContextMinimal, ToolDefinition } from '@/lib/agent';
import { del, fetchSSE, get, getBlob, post } from './client';

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
