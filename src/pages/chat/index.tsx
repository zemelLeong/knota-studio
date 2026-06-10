import { Icon } from '@iconify/react';
import { useRequest } from 'ahooks';
import dayjs from 'dayjs';
import type { ChangeEvent } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { smallUpload } from '@/api/files';
import type {
  ChatSession,
  QaCitation,
  QaPhase,
  QaStreamEvent,
  QaStreamResponse,
} from '@/api/knowledge-base';
import {
  askQuestionStream,
  debugExportSession,
  deleteChatSession,
  exportSession,
  getChatSession,
  listChatSessions,
  listLibraries,
  postToolResult,
} from '@/api/knowledge-base';
import { getUserMenus } from '@/api/menu';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useT } from '@/i18n';
import {
  executeFrontendTool,
  executeGlobalTool,
  generateGlobalTools,
  generatePageContext,
  generatePageToolSchemas,
  isFrontendTool,
  isGlobalTool,
} from '@/lib/agent';
import { cn } from '@/lib/utils';
import { useAgentStore } from '@/stores/agent';
import { toast } from '@/utils/toast';
import {
  AiMessage,
  EmptyState,
  PageContextPopover,
  SessionItem,
  TimeDivider,
  UserMessage,
} from './components';
import {
  allKnowledgeScopeValue,
  buildKnowledgeScopeLabel,
  createPhaseLabelMap,
  createToolCallLabels,
  downloadBlob,
  formatRoundMarkdown,
  formatTimeDivider,
  inlineTextThreshold,
  loadLibraryFolders,
  nextMsgKey,
  noKnowledgeScopeValue,
  resolveMaterialType,
  wholeLibraryFolderValue,
} from './helpers';
import type {
  AttachedFile,
  ContentPart,
  KnowledgeScope,
  UiMessage,
} from './types';

// ─── Main Component ─────────────────────────────────────

const KbChat = () => {
  const t = useT();

  // --- Memoized label maps (depend on t) ---
  const toolCallLabels = useMemo(() => createToolCallLabels(t), [t]);
  const phaseLabelMap = useMemo(() => createPhaseLabelMap(t), [t]);

  // --- State ---
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | undefined>();
  const [sessionListOpen, setSessionListOpen] = useState(false);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const [inlineText, setInlineText] = useState<string | undefined>();
  const [knowledgeBaseEnabled, setKnowledgeBaseEnabled] = useState(false);
  const [selectedLibraryId, setSelectedLibraryId] = useState<string>();
  const [selectedFolderId, setSelectedFolderId] = useState<string>();
  const [includeSubfolders, setIncludeSubfolders] = useState(true);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | undefined>();

  const abortRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesAreaRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollReasonRef = useRef<'bottom' | 'top' | null>(null);
  const scrollToMsgKeyRef = useRef<string | null>(null);
  const activeSessionIdRef = useRef<string | undefined>(undefined);

  const navigate = useNavigate();
  const { data: menuTree } = useRequest(getUserMenus, { manual: false });
  const { data: libraries = [] } = useRequest(listLibraries);
  const { data: scopeFolders = [] } = useRequest(
    async () => {
      if (!selectedLibraryId) return [];
      return loadLibraryFolders(selectedLibraryId);
    },
    {
      refreshDeps: [selectedLibraryId],
    },
  );

  const openCitationPreview = useCallback(
    (citation: QaCitation) => {
      const params = new URLSearchParams({
        previewDocumentId: citation.documentId,
      });
      if (citation.startLine) {
        params.set('startLine', String(citation.startLine));
      }
      if (citation.endLine) {
        params.set('endLine', String(citation.endLine));
      }
      navigate(`/knowledge-base?${params.toString()}`);
    },
    [navigate],
  );

  // --- Sessions loading ---
  const { loading: sessionsLoading, run: loadSessions } = useRequest(
    listChatSessions,
    {
      manual: true,
      onSuccess: (data) => {
        setSessions(data);
      },
    },
  );

  const setActiveSession = useCallback((id: string | undefined) => {
    activeSessionIdRef.current = id;
    setActiveSessionId(id);
  }, []);

  // Load session messages
  const { run: loadSessionMessages } = useRequest(getChatSession, {
    manual: true,
    onSuccess: (detail) => {
      const uiMessages: UiMessage[] = detail.messages
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .map((m) => {
          // Restore content parts from tokenUsage.contentParts
          const apiParts = m.tokenUsage?.contentParts;
          const parts: ContentPart[] = apiParts
            ? apiParts.map((p) => {
                if (p.type === 'tool_call') {
                  return {
                    type: 'tool_call' as const,
                    toolName: p.toolName,
                    toolCallId: p.toolCallId ?? '',
                    status: 'completed' as const,
                    resultPreview: p.resultPreview ?? '',
                    resultFull: p.resultFull,
                    durationMs: p.durationMs,
                    createdAt: p.createdAt,
                  };
                }
                return {
                  type: 'text' as const,
                  content: p.content,
                  createdAt: p.createdAt,
                };
              })
            : [];

          // Restore material refs
          const inlineRef = m.materialRefs?.inline;
          const scopeLabel = buildKnowledgeScopeLabel(m.materialRefs, t);
          const materialType = resolveMaterialType(inlineRef, scopeLabel);
          const inlineText = inlineRef?.content;

          return {
            key: m.id,
            role: m.role as 'user' | 'assistant',
            content: m.content,
            parts,
            loading: false,
            hasMaterial: !!inlineRef,
            materialType,
            fileName: undefined,
            inlineText,
            knowledgeScopeLabel: scopeLabel,
            phase: undefined,
            citations: m.tokenUsage?.citations ?? [],
            fileIds: [],
            fileNames: [],
            createdAt: m.createdAt,
          };
        });
      setMessages(uiMessages);
    },
  });

  // Load sessions on mount
  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  useEffect(() => {
    if (
      selectedLibraryId &&
      !libraries.some((library) => library.id === selectedLibraryId)
    ) {
      setSelectedLibraryId(undefined);
      setSelectedFolderId(undefined);
      setIncludeSubfolders(true);
    }
  }, [libraries, selectedLibraryId]);

  useEffect(() => {
    if (
      selectedFolderId &&
      !scopeFolders.some((folder) => folder.id === selectedFolderId)
    ) {
      setSelectedFolderId(undefined);
      setIncludeSubfolders(true);
    }
  }, [scopeFolders, selectedFolderId]);

  // Scroll handling
  // biome-ignore lint/correctness/useExhaustiveDependencies: messages change triggers scroll
  useEffect(() => {
    if (scrollReasonRef.current === 'bottom') {
      scrollReasonRef.current = null;
      messagesAreaRef.current?.scrollTo({
        top: messagesAreaRef.current.scrollHeight,
      });
      return;
    }
    if (scrollReasonRef.current === 'top') {
      scrollReasonRef.current = null;
      messagesAreaRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    // Scroll to a specific user message (Claude-style: new message at top of viewport)
    const msgKey = scrollToMsgKeyRef.current;
    if (msgKey) {
      scrollToMsgKeyRef.current = null;
      const el = messagesAreaRef.current?.querySelector(
        `[data-msg-key="${msgKey}"]`,
      );
      el?.scrollIntoView({ block: 'start' });
    }
  }, [messages]);

  // Click outside session list to close
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!sessionListOpen) return;
      const target = e.target as HTMLElement;
      // Close if click is outside the session toggle button AND outside the session list panel
      const isToggle = target.closest('[data-session-toggle]');
      const isPanel = target.closest('[data-session-panel]');
      if (!isToggle && !isPanel) {
        setSessionListOpen(false);
        setDeleteConfirmId(undefined);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [sessionListOpen]);

  // Escape to close
  useEffect(() => {
    const handler = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSessionListOpen(false);
        setDeleteConfirmId(undefined);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  // --- Computed ---
  const activeSession = useMemo(
    () => sessions.find((s) => s.id === activeSessionId),
    [sessions, activeSessionId],
  );

  const selectedLibrary = useMemo(
    () => libraries.find((library) => library.id === selectedLibraryId),
    [libraries, selectedLibraryId],
  );

  const selectedFolder = useMemo(
    () => scopeFolders.find((folder) => folder.id === selectedFolderId),
    [scopeFolders, selectedFolderId],
  );

  const knowledgeScope = useMemo<KnowledgeScope | undefined>(() => {
    if (!knowledgeBaseEnabled) return undefined;
    if (!selectedLibrary) {
      return {
        label: '知识库范围：全部知识库',
      };
    }
    if (selectedFolder) {
      const suffix = includeSubfolders ? '（含子目录）' : '（仅当前目录）';
      return {
        libraryId: selectedLibrary.id,
        folderId: selectedFolder.id,
        includeSubfolders,
        label: `知识库范围：${selectedLibrary.name} / ${selectedFolder.name}${suffix}`,
      };
    }
    return {
      libraryId: selectedLibrary.id,
      label: `知识库范围：${selectedLibrary.name}`,
    };
  }, [
    includeSubfolders,
    knowledgeBaseEnabled,
    selectedFolder,
    selectedLibrary,
  ]);

  const knowledgeScopeDisplay = useMemo(() => {
    if (!knowledgeBaseEnabled) return '不使用知识库';
    if (!selectedLibrary) return '全部知识库';
    if (selectedFolder)
      return `${selectedLibrary.name} / ${selectedFolder.name}${
        includeSubfolders ? ' · 含子目录' : ' · 仅当前目录'
      }`;
    return selectedLibrary.name;
  }, [
    includeSubfolders,
    knowledgeBaseEnabled,
    selectedFolder,
    selectedLibrary,
  ]);

  const sessionMeta = useMemo(() => {
    if (!activeSession) return '';
    const title = activeSession.title ?? t('KbChat.session.untitled', '未命名');
    return title.slice(0, 20);
  }, [activeSession, t]);

  // Group messages into conversation rounds (user + assistant pairs)
  const conversationRounds = useMemo(() => {
    const rounds: Array<{
      key: string;
      dividerLabel?: string;
      userMsg?: UiMessage;
      aiMsg?: UiMessage;
    }> = [];
    let currentDivider: string | undefined;

    messages.forEach((msg, idx) => {
      const prev = idx > 0 ? messages[idx - 1] : undefined;
      const prevTime = prev ? dayjs(prev.createdAt) : null;
      const currTime = dayjs(msg.createdAt);
      const needDivider =
        !prevTime ||
        prevTime.format('YYYY-MM-DD HH') !== currTime.format('YYYY-MM-DD HH');
      if (needDivider) {
        currentDivider = formatTimeDivider(msg.createdAt);
      }

      if (msg.role === 'user') {
        rounds.push({
          key: msg.key,
          dividerLabel: currentDivider,
          userMsg: msg,
        });
        currentDivider = undefined;
      } else {
        // assistant message — attach to last round
        const lastRound = rounds[rounds.length - 1];
        if (lastRound) {
          lastRound.aiMsg = msg;
          lastRound.key = `${lastRound.key}-${msg.key}`;
        }
      }
    });
    return rounds;
  }, [messages]);

  const hasMessages = messages.length > 0;

  // --- Session actions ---
  const handleToggleSessionList = useCallback(() => {
    setSessionListOpen((prev) => !prev);
    setDeleteConfirmId(undefined);
  }, []);

  const handleSwitchSession = useCallback(
    (session: ChatSession) => {
      scrollReasonRef.current = 'bottom';
      setActiveSession(session.id);
      setSessionListOpen(false);
      setDeleteConfirmId(undefined);
      loadSessionMessages(session.id);
    },
    [loadSessionMessages, setActiveSession],
  );

  const handleNewChat = useCallback(() => {
    scrollReasonRef.current = null;
    setActiveSession(undefined);
    setMessages([]);
    setDeleteConfirmId(undefined);
  }, [setActiveSession]);

  const handleDeleteSession = useCallback(
    (id: string) => {
      deleteChatSession(id).then(() => {
        toast.success(t('KbChat.session.deleted', '会话已删除'));
        setSessions((prev) => prev.filter((s) => s.id !== id));
        if (activeSessionId === id) {
          setActiveSession(undefined);
          setMessages([]);
        }
        setDeleteConfirmId(undefined);
      });
    },
    [activeSessionId, setActiveSession, t],
  );

  // --- Export ---
  const handleExport = useCallback(() => {
    if (!activeSessionId) return;
    exportSession(activeSessionId)
      .then((blob) => {
        downloadBlob(blob, `chat-${activeSessionId}.md`);
      })
      .catch(() => {
        toast.assertNotApiError.error(
          t('KbChat.session.exportFailed', '导出失败'),
        );
      });
  }, [activeSessionId, t]);

  const handleDebugExport = useCallback(() => {
    if (!activeSessionId) return;
    debugExportSession(activeSessionId)
      .then((blob) => {
        downloadBlob(blob, `chat-${activeSessionId}-debug.html`);
      })
      .catch(() => {
        toast.assertNotApiError.error(
          t('KbChat.session.debugExportFailed', '调试导出失败'),
        );
      });
  }, [activeSessionId, t]);

  // --- File attach ---
  const handleFileSelect = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    Array.from(files).forEach((file) => {
      smallUpload(file).then((resp) => {
        setAttachedFiles((prev) => [...prev, { id: resp.id, name: file.name }]);
      });
    });
    // Reset input so same file can be selected again
    e.target.value = '';
  }, []);

  const handleRemoveAttachment = useCallback((id: string) => {
    setAttachedFiles((prev) => prev.filter((f) => f.id !== id));
  }, []);

  // --- Paste detection ---
  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const text = e.clipboardData.getData('text/plain');
      if (text.length > inlineTextThreshold && !inlineText) {
        e.preventDefault();
        setInlineText(text);
        toast.success(t('KbChat.material.captured', '长文本已作为材料添加'));
      }
    },
    [inlineText, t],
  );

  const handleRemoveInlineText = useCallback(() => {
    setInlineText(undefined);
  }, []);

  // --- Stop streaming ---
  const handleStop = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setIsStreaming(false);
    // Keep current messages with their accumulated partial content
    setMessages((prev) =>
      prev.map((m) => (m.loading ? { ...m, loading: false } : m)),
    );
  }, []);

  // --- Send message ---
  const handleSend = useCallback(() => {
    const text = inputValue.trim();
    if (!text || isStreaming) return;
    const requestSessionId = activeSessionIdRef.current;

    // Build user message
    let materialType: UiMessage['materialType'];
    if (inlineText) {
      materialType = 'inline';
    } else if (attachedFiles.length > 0) {
      materialType = 'file';
    } else if (knowledgeBaseEnabled) {
      materialType = 'knowledge';
    }

    const userMsg: UiMessage = {
      key: nextMsgKey(),
      role: 'user',
      content: text,
      parts: [],
      loading: false,
      hasMaterial:
        attachedFiles.length > 0 || !!inlineText || knowledgeBaseEnabled,
      materialType,
      fileName: undefined,
      inlineText,
      knowledgeScopeLabel: knowledgeScope?.label,
      phase: undefined,
      citations: [],
      fileIds: attachedFiles.map((f) => f.id),
      fileNames: attachedFiles.map((f) => f.name),
      createdAt: new Date().toISOString(),
    };

    // Build assistant placeholder
    const assistantKey = nextMsgKey();

    setMessages((prev) => [
      ...prev,
      userMsg,
      {
        key: assistantKey,
        role: 'assistant',
        content: '',
        parts: [],
        loading: true,
        hasMaterial: false,
        materialType: undefined,
        fileName: undefined,
        inlineText: undefined,
        knowledgeScopeLabel: undefined,
        phase: undefined,
        citations: [],
        fileIds: [],
        fileNames: [],
        createdAt: new Date().toISOString(),
      },
    ]);
    scrollToMsgKeyRef.current = userMsg.key;
    setInputValue('');
    setAttachedFiles([]);
    setInlineText(undefined);

    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }

    // Build request
    const material = {
      useKnowledgeBase: knowledgeBaseEnabled,
      inline: inlineText,
      libraryId: knowledgeScope?.libraryId,
      folderId: knowledgeScope?.folderId,
      knowledgeScopeLabel: knowledgeScope?.label,
      includeSubfolders: knowledgeScope?.includeSubfolders,
      fileIds:
        attachedFiles.length > 0 ? attachedFiles.map((f) => f.id) : undefined,
    };

    const abort = new AbortController();
    abortRef.current = abort;
    setIsStreaming(true);

    // Capture pages map + active route snapshot for this request.
    const { pages, activeRoute } = useAgentStore.getState();

    const request: {
      instruction: string;
      material?: {
        inline?: string;
        useKnowledgeBase?: boolean;
        libraryId?: string;
        folderId?: string;
        knowledgeScopeLabel?: string;
        includeSubfolders?: boolean;
        fileIds?: string[];
      };
      sessionId?: string;
      pageTools?: ReturnType<typeof generatePageToolSchemas>;
      pageContext?: ReturnType<typeof generatePageContext>[];
    } = {
      instruction: text,
      material,
      sessionId: requestSessionId,
    };

    // Attach page tools + context if capabilities are registered
    // Global tools always available
    const globalTools = generateGlobalTools();

    // Page-specific tools + context (when pages are registered)
    if (pages.size > 0) {
      const pageTools = generatePageToolSchemas(pages, activeRoute);
      request.pageTools = [...globalTools, ...pageTools];
      request.pageContext = [...pages.values()].map((caps) => ({
        ...generatePageContext(caps),
        active: caps.meta.route === activeRoute,
      }));
    } else {
      request.pageTools = globalTools;
    }

    const onEvent = (event: QaStreamEvent) => {
      // --- Side effects (outside state updater) ---
      if (event.type === 'Started') {
        const e = event as { type: 'Started'; data: { sessionId: string } };
        setActiveSession(e.data.sessionId);
      }

      if (event.type === 'ToolCallStarted') {
        const e = event as {
          type: 'ToolCallStarted';
          data: {
            toolName: string;
            toolCallId: string;
            arguments: Record<string, unknown>;
          };
        };
        const { toolCallId, toolName, arguments: args } = e.data;

        if (isGlobalTool(toolName)) {
          void executeGlobalTool(
            toolName,
            args,
            {
              menuTree: menuTree ?? [],
              navigate,
            },
            t,
          )
            .then((result) => {
              let output: string | Record<string, unknown> | undefined;
              if (result.data != null) {
                output =
                  typeof result.data === 'string'
                    ? result.data
                    : (result.data as Record<string, unknown>);
              }
              return postToolResult({
                toolCallId: toolCallId,
                status: result.success ? 'success' : 'error',
                output:
                  typeof output === 'string'
                    ? undefined
                    : (output as Record<string, unknown> | undefined),
                error: result.error,
              });
            })
            .catch((err: unknown) => {
              const message = err instanceof Error ? err.message : String(err);
              void postToolResult({
                toolCallId: toolCallId,
                status: 'error',
                error: message,
              });
            });
        } else if (isFrontendTool(toolName)) {
          // Read store live — navigation may register new pages after snapshot
          const liveState = useAgentStore.getState();
          if (liveState.pages.size === 0) return;
          void executeFrontendTool(
            toolName,
            args,
            liveState.pages,
            liveState.activeRoute,
            t,
          )
            .then((result) => {
              let output: string | Record<string, unknown> | undefined;
              if (result.data != null) {
                output =
                  typeof result.data === 'string'
                    ? result.data
                    : (result.data as Record<string, unknown>);
              }
              return postToolResult({
                toolCallId: toolCallId,
                status: result.success ? 'success' : 'error',
                output:
                  typeof output === 'string'
                    ? undefined
                    : (output as Record<string, unknown> | undefined),
                error: result.error,
              });
            })
            .catch((err: unknown) => {
              const message = err instanceof Error ? err.message : String(err);
              void postToolResult({
                toolCallId: toolCallId,
                status: 'error',
                error: message,
              });
            });
        }
      }

      // --- State updates ---
      setMessages((prev) => {
        const updated = [...prev];
        const aIdx = updated.findIndex((m) => m.key === assistantKey);
        if (aIdx === -1) return prev;

        const assistant = { ...updated[aIdx], parts: [...updated[aIdx].parts] };

        const handleEvent: Partial<
          Record<string, (ev: QaStreamEvent) => void>
        > = {
          PhaseChanged: (ev) => {
            const e = ev as {
              type: 'PhaseChanged';
              data: { phase: QaPhase };
            };
            const phaseType = e.data.phase.type;
            const formatter = phaseLabelMap[phaseType];
            const detail =
              phaseType === 'MaterialProcessing'
                ? (
                    e.data.phase as {
                      type: 'MaterialProcessing';
                      detail: { strategy: string; totalChunks: number | null };
                    }
                  ).detail
                : ({} as Record<string, unknown>);
            const label = formatter
              ? formatter(detail as Record<string, unknown>)
              : phaseType;
            assistant.phase = label;
          },
          ToolCallStarted: (ev) => {
            const e = ev as {
              type: 'ToolCallStarted';
              data: {
                toolName: string;
                toolCallId: string;
                arguments: Record<string, unknown>;
              };
            };
            assistant.parts = [
              ...assistant.parts,
              {
                type: 'tool_call' as const,
                toolName: e.data.toolName,
                toolCallId: e.data.toolCallId,
                status: 'running' as const,
                createdAt: new Date().toISOString(),
              },
            ];
          },
          ToolCallCompleted: (ev) => {
            const e = ev as {
              type: 'ToolCallCompleted';
              data: {
                toolName: string;
                toolCallId: string;
                resultPreview: string;
                resultFull?: string;
                durationMs: number;
              };
            };
            // Match by toolCallId first (exact). If IDs don't match (e.g. frontend tools
            // where Stub emits Started with page-{nanoid} but Hook emits Completed with
            // internal_call_id), fall back to toolName + status === 'running'.
            assistant.parts = assistant.parts.map((p) => {
              const idMatch = p.toolCallId === e.data.toolCallId;
              const nameMatch =
                p.toolName === e.data.toolName && p.status === 'running';
              const shouldUpdate = idMatch || nameMatch;
              return shouldUpdate
                ? {
                    ...p,
                    status: 'completed' as const,
                    resultPreview: e.data.resultPreview,
                    resultFull: e.data.resultFull,
                    durationMs: e.data.durationMs,
                  }
                : p;
            });
          },
          AnswerToken: (ev) => {
            const e = ev as {
              type: 'AnswerToken';
              data: { token: string };
            };
            assistant.content += e.data.token;
            // Find last text part or create one
            const lastPart = assistant.parts[assistant.parts.length - 1];
            if (lastPart && lastPart.type === 'text') {
              assistant.parts = assistant.parts.map((p, i) =>
                i === assistant.parts.length - 1
                  ? { ...p, content: (p.content ?? '') + e.data.token }
                  : p,
              );
            } else {
              assistant.parts = [
                ...assistant.parts,
                {
                  type: 'text' as const,
                  content: e.data.token,
                  createdAt: new Date().toISOString(),
                },
              ];
            }
          },
          Completed: (ev) => {
            const e = ev as {
              type: 'Completed';
              data: { response: QaStreamResponse };
            };
            setActiveSession(e.data.response.sessionId);
            assistant.loading = false;
            assistant.citations = e.data.response.citations;
            setIsStreaming(false);
            abortRef.current = null;
            // Refresh sessions list since a new one might have been created
            loadSessions();
          },
          Error: (ev) => {
            const e = ev as { type: 'Error'; data: { message: string } };
            assistant.loading = false;
            assistant.content = e.data.message;
            setIsStreaming(false);
            abortRef.current = null;
          },
        };

        const handler = handleEvent[event.type];
        if (handler) handler(event);

        updated[aIdx] = assistant;
        return updated;
      });
    };

    askQuestionStream(request, onEvent, abort.signal).catch((err) => {
      // Don't overwrite content on user-initiated abort - partial content is already visible
      if (err instanceof DOMException && err.name === 'AbortError') {
        // User clicked stop - keep partial content as-is
        setMessages((prev) =>
          prev.map((m) => (m.loading ? { ...m, loading: false } : m)),
        );
      } else {
        setMessages((prev) => {
          const updated = [...prev];
          const aIdx = updated.findIndex((m) => m.key === assistantKey);
          if (aIdx !== -1) {
            updated[aIdx] = {
              ...updated[aIdx],
              loading: false,
              content: t('KbChat.error.failed', '请求失败，请稍后重试'),
            };
          }
          return updated;
        });
      }
      setIsStreaming(false);
      abortRef.current = null;
    });
  }, [
    inputValue,
    isStreaming,
    attachedFiles,
    inlineText,
    knowledgeBaseEnabled,
    knowledgeScope,
    setActiveSession,
    loadSessions,
    t,
    phaseLabelMap,
    menuTree,
    navigate,
  ]);

  // --- Textarea handlers ---
  const handleInputChange = useCallback(
    (e: ChangeEvent<HTMLTextAreaElement>) => {
      setInputValue(e.target.value);
      // Auto-grow
      const el = e.target;
      el.style.height = 'auto';
      el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
    },
    [],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  // --- Render ---
  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* ─── Chat Header ─── */}
      <header className="flex items-center gap-3 px-5 py-3 bg-card border-b shrink-0">
        <div className="size-7 rounded-md bg-linear-to-br from-teal-500 to-teal-600 grid place-items-center">
          <Icon icon="lucide:message-square" className="size-4 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-semibold tracking-tight leading-snug">
            {t('KbChat.panelTitle', 'Knota 助手')}
          </h2>
          {sessionMeta && (
            <span className="text-[11px] text-muted-foreground mt-0.5 block">
              {sessionMeta}
            </span>
          )}
        </div>

        {/* Session switcher */}
        <div data-session-toggle>
          <button
            type="button"
            className={cn(
              'inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium text-muted-foreground bg-muted border border-border cursor-pointer transition-all hover:bg-accent hover:text-accent-foreground',
              sessionListOpen &&
                'bg-orange-50 dark:bg-orange-900/25 text-orange-700 dark:text-orange-400 border-orange-200 dark:border-orange-800',
            )}
            onClick={handleToggleSessionList}
          >
            <Icon
              icon="lucide:chevron-down"
              className={cn(
                'size-3 transition-transform duration-200',
                sessionListOpen && 'rotate-180',
              )}
            />
            {sessionsLoading
              ? t('KbChat.session.loading', '加载会话...')
              : `${sessions.length}${t('KbChat.session.countShort', '条')}${t('KbChat.session.historyLabel', '历史')}`}
          </button>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1">
          <PageContextPopover />
          <button
            type="button"
            className="size-7 grid place-items-center rounded-md border-none bg-transparent text-muted-foreground cursor-pointer transition-all hover:bg-accent hover:text-foreground"
            title={t('KbChat.session.export', '导出对话')}
            onClick={handleExport}
          >
            <Icon icon="lucide:download" className="size-4" />
          </button>
          <button
            type="button"
            className="h-7 px-2 border border-dashed border-border bg-transparent rounded-md grid place-items-center text-muted-foreground font-mono text-[11px] font-medium cursor-pointer transition-all hover:bg-accent hover:text-foreground opacity-70 hover:opacity-100"
            title={t('KbChat.session.debugExport', '调试导出')}
            onClick={handleDebugExport}
          >
            {t('KbChat.session.debugExportLabel', 'Debug')}
          </button>
        </div>
      </header>

      {/* Session list panel — push-down, part of page layout */}
      <div
        data-session-panel
        className={cn(
          'shrink-0 bg-card border-b overflow-hidden transition-all duration-250',
          sessionListOpen
            ? 'max-h-55 opacity-100 border-border'
            : 'max-h-0 opacity-0 border-transparent',
        )}
      >
        <div className="max-h-50 overflow-y-auto p-1">
          {/* New chat */}
          <button
            type="button"
            className={cn(
              'flex w-full items-center gap-2 px-3 py-2 rounded-md cursor-pointer transition-colors text-sm text-muted-foreground hover:bg-accent',
              !activeSessionId &&
                'bg-orange-50 dark:bg-orange-900/25 text-orange-700 dark:text-orange-400 font-medium',
            )}
            onClick={handleNewChat}
          >
            <span className="truncate">
              {t('KbChat.session.new', '新对话')}
            </span>
          </button>
          {sessions.map((session) => (
            <SessionItem
              key={session.id}
              session={session}
              isActive={activeSessionId === session.id}
              onSelect={() => handleSwitchSession(session)}
              deleteConfirmId={deleteConfirmId}
              onDeleteConfirm={() => handleDeleteSession(session.id)}
              onDeleteCancel={() => setDeleteConfirmId(undefined)}
              onDeleteRequest={() => setDeleteConfirmId(session.id)}
              t={t}
            />
          ))}
        </div>
      </div>

      {/* ─── Messages area ─── */}
      {hasMessages ? (
        <div
          ref={messagesAreaRef}
          className="flex-1 overflow-y-auto px-5 py-6 scroll-smooth scrollbar-thin"
        >
          {conversationRounds.map((round, idx) => {
            const isLast = idx === conversationRounds.length - 1;
            return (
              <div
                key={round.key}
                data-msg-key={round.userMsg?.key}
                className={`group/round${isLast ? ' min-h-full' : ''}`}
              >
                {round.dividerLabel && (
                  <TimeDivider label={round.dividerLabel} />
                )}
                {round.userMsg && (
                  <UserMessage
                    msg={round.userMsg}
                    t={t}
                    onCopyRound={
                      round.aiMsg && !round.aiMsg.loading && round.aiMsg.content
                        ? () => {
                            const md = formatRoundMarkdown(round);
                            navigator.clipboard.writeText(md).then(
                              () => toast.success(t('KbChat.copied', '已复制')),
                              () =>
                                toast.assertNotApiError.error(
                                  t('KbChat.copyFailed', '复制失败'),
                                ),
                            );
                          }
                        : undefined
                    }
                  />
                )}
                {round.aiMsg && (
                  <AiMessage
                    msg={round.aiMsg}
                    t={t}
                    labels={toolCallLabels}
                    onOpenCitation={openCitationPreview}
                  />
                )}
              </div>
            );
          })}
          <div ref={messagesEndRef} />
        </div>
      ) : (
        <EmptyState
          placeholder={t('KbChat.placeholder', '有什么可以帮你的？')}
        />
      )}

      {/* ─── Input area ─── */}
      <div className="shrink-0 px-5 py-4 bg-card border-t">
        <div className="mb-2 flex items-center">
          <Popover>
            <div
              className={cn(
                'inline-flex max-w-full items-center overflow-hidden rounded-full border text-xs font-medium transition-colors',
                knowledgeBaseEnabled
                  ? 'border-purple-200 bg-purple-50 text-purple-700 dark:border-purple-800 dark:bg-purple-900/30 dark:text-purple-200'
                  : 'border-border bg-muted text-muted-foreground',
              )}
            >
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    'inline-flex min-w-0 items-center gap-1.5 px-2.5 py-1 transition-colors',
                    knowledgeBaseEnabled
                      ? 'hover:bg-purple-100 hover:text-purple-800 dark:hover:bg-purple-900/50 dark:hover:text-purple-100'
                      : 'hover:bg-accent hover:text-foreground',
                  )}
                >
                  <Icon icon="lucide:library" className="size-3.5 shrink-0" />
                  <span className="truncate">{knowledgeScopeDisplay}</span>
                  {!knowledgeBaseEnabled && (
                    <Icon
                      icon="lucide:chevron-down"
                      className="size-3 shrink-0 opacity-60"
                    />
                  )}
                </button>
              </PopoverTrigger>
              {knowledgeBaseEnabled && (
                <button
                  type="button"
                  title="不使用知识库"
                  aria-label="清除知识库范围"
                  className="grid size-6 shrink-0 place-items-center border-l border-purple-200/80 text-purple-500 transition-colors hover:bg-purple-100 hover:text-purple-800 dark:border-purple-800 dark:text-purple-200 dark:hover:bg-purple-900/50 dark:hover:text-purple-100"
                  onClick={() => {
                    setKnowledgeBaseEnabled(false);
                    setSelectedLibraryId(undefined);
                    setSelectedFolderId(undefined);
                    setIncludeSubfolders(true);
                  }}
                >
                  <Icon icon="lucide:x" className="size-3.5" />
                </button>
              )}
            </div>
            <PopoverContent align="start" className="w-80 p-3">
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-foreground">
                      知识库范围
                    </div>
                    <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                      {knowledgeScopeDisplay}
                    </div>
                  </div>
                  {knowledgeBaseEnabled && (
                    <button
                      type="button"
                      className="shrink-0 rounded-md border border-border bg-transparent px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                      onClick={() => {
                        setKnowledgeBaseEnabled(false);
                        setSelectedLibraryId(undefined);
                        setSelectedFolderId(undefined);
                        setIncludeSubfolders(true);
                      }}
                    >
                      不使用
                    </button>
                  )}
                </div>

                <Select
                  value={
                    knowledgeBaseEnabled
                      ? (selectedLibraryId ?? allKnowledgeScopeValue)
                      : noKnowledgeScopeValue
                  }
                  onValueChange={(value) => {
                    setSelectedFolderId(undefined);
                    setIncludeSubfolders(true);
                    if (value === noKnowledgeScopeValue) {
                      setKnowledgeBaseEnabled(false);
                      setSelectedLibraryId(undefined);
                      return;
                    }
                    setKnowledgeBaseEnabled(true);
                    setSelectedLibraryId(
                      value === allKnowledgeScopeValue ? undefined : value,
                    );
                  }}
                >
                  <SelectTrigger className="h-8 bg-background text-xs">
                    <SelectValue placeholder="不使用知识库" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={noKnowledgeScopeValue}>
                      不使用知识库
                    </SelectItem>
                    <SelectItem value={allKnowledgeScopeValue}>
                      全部知识库
                    </SelectItem>
                    {libraries.map((library) => (
                      <SelectItem key={library.id} value={library.id}>
                        {library.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {knowledgeBaseEnabled && selectedLibraryId && (
                  <Select
                    value={selectedFolderId ?? wholeLibraryFolderValue}
                    onValueChange={(value) => {
                      setSelectedFolderId(
                        value === wholeLibraryFolderValue ? undefined : value,
                      );
                      setIncludeSubfolders(true);
                    }}
                  >
                    <SelectTrigger className="h-8 bg-background text-xs">
                      <SelectValue placeholder="整个知识库" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={wholeLibraryFolderValue}>
                        整个知识库
                      </SelectItem>
                      {scopeFolders.map((folder) => (
                        <SelectItem key={folder.id} value={folder.id}>
                          {'  '.repeat(folder.depth)}
                          {folder.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}

                {knowledgeBaseEnabled && selectedFolderId && (
                  <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/30 px-2.5 py-2">
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-foreground">
                        包含子目录
                      </div>
                      <div className="mt-0.5 text-[11px] text-muted-foreground">
                        开启后检索当前目录及全部下级目录
                      </div>
                    </div>
                    <Switch
                      checked={includeSubfolders}
                      onCheckedChange={setIncludeSubfolders}
                    />
                  </div>
                )}
              </div>
            </PopoverContent>
          </Popover>
        </div>

        {/* Material indicators */}
        {(attachedFiles.length > 0 || inlineText) && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {attachedFiles.map((f) => (
              <span
                key={f.id}
                className={cn(
                  'file-chip-emerald inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800',
                )}
              >
                <Icon icon="lucide:paperclip" className="size-3" />
                {f.name}
                <button
                  type="button"
                  className="grid place-items-center text-emerald-500 hover:text-emerald-700 dark:hover:text-emerald-300 bg-transparent border-none cursor-pointer p-0"
                  onClick={() => handleRemoveAttachment(f.id)}
                >
                  <Icon icon="lucide:x" className="size-3" />
                </button>
              </span>
            ))}
            {inlineText && (
              <span className="file-chip-blue inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 border border-blue-200 dark:border-blue-800">
                <Icon icon="lucide:file-text" className="size-3" />
                {t('KbChat.material.inlineTag', '长文本材料')} (
                {inlineText.length} {t('KbChat.material.chars', '字')})
                <button
                  type="button"
                  className="grid place-items-center text-blue-500 hover:text-blue-700 dark:hover:text-blue-300 bg-transparent border-none cursor-pointer p-0"
                  onClick={handleRemoveInlineText}
                >
                  <Icon icon="lucide:x" className="size-3" />
                </button>
              </span>
            )}
          </div>
        )}

        {/* Input row */}
        <div className="input-focus-ring flex items-end gap-2 bg-muted border border-border rounded-xl p-2 transition-all focus-within:border-teal-500 dark:focus-within:border-teal-500 focus-within:shadow-[0_0_0_3px_rgba(13,148,136,0.1)] dark:focus-within:shadow-[0_0_0_3px_rgba(13,148,136,0.15)]">
          <button
            type="button"
            className="size-7.5 grid place-items-center rounded-md border-none bg-transparent text-muted-foreground shrink-0 cursor-pointer transition-all hover:bg-accent hover:text-foreground"
            title={t('KbChat.attach.file', '添加文件')}
            onClick={() => fileInputRef.current?.click()}
          >
            <Icon icon="lucide:paperclip" className="size-4.5" />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={handleFileSelect}
          />
          <textarea
            ref={textareaRef}
            value={inputValue}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={t('KbChat.input.placeholder', '输入问题...')}
            rows={1}
            className="flex-1 border-none bg-transparent font-sans text-sm text-foreground resize-none outline-none min-h-5.5 max-h-30 leading-normal py-1 placeholder:text-muted-foreground"
          />
          {isStreaming ? (
            <button
              type="button"
              title={t('KbChat.stop', '停止生成')}
              className="size-8 grid place-items-center rounded-md border-none bg-orange-700 text-white shrink-0 cursor-pointer transition-all shadow-xs hover:bg-orange-800"
              onClick={handleStop}
            >
              <Icon icon="lucide:square" className="size-4" />
            </button>
          ) : (
            <button
              type="button"
              className="size-8 grid place-items-center rounded-md border-none bg-orange-700 text-white shrink-0 cursor-pointer transition-all shadow-xs hover:bg-orange-800 disabled:opacity-50 disabled:pointer-events-none"
              onClick={handleSend}
              disabled={!inputValue.trim()}
            >
              <Icon icon="lucide:send" className="size-4" />
            </button>
          )}
        </div>
        <div className="mt-2 text-center text-[11px] text-muted-foreground">
          {t('KbChat.input.hint', '按 Enter 发送 · Shift+Enter 换行')}
        </div>
      </div>
    </div>
  );
};

export default KbChat;
