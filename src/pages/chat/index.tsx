import { Icon } from '@iconify/react';
import { useRequest } from 'ahooks';
import dayjs from 'dayjs';
import type { ChangeEvent } from 'react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import { useNavigate } from 'react-router-dom';
import remarkGfm from 'remark-gfm';
import { smallUpload } from '@/api/files';
import type { ChatSession, QaPhase, QaStreamEvent } from '@/api/knowledge-base';
import {
  askQuestionStream,
  debugExportSession,
  deleteChatSession,
  exportSession,
  getChatSession,
  listChatSessions,
  postToolResult,
} from '@/api/knowledge-base';
import { getUserMenus } from '@/api/menu';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import type { TFn } from '@/i18n';
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

// ─── Types ──────────────────────────────────────────────

interface ContentPart {
  createdAt: string;
  type: 'text' | 'tool_call';
  content?: string;
  toolName?: string;
  toolCallId?: string;
  status?: 'running' | 'completed';
  resultPreview?: string;
  resultFull?: string;
  durationMs?: number;
}

interface UiMessage {
  key: string;
  role: 'user' | 'assistant';
  content: string;
  parts: ContentPart[];
  loading: boolean;
  hasMaterial: boolean;
  materialType: 'file' | 'inline' | undefined;
  fileName: string | undefined;
  inlineText: string | undefined;
  phase: string | undefined;
  fileIds: string[];
  fileNames: string[];
  createdAt: string;
}

interface AttachedFile {
  id: string;
  name: string;
}

// ─── Constants ──────────────────────────────────────────

const createToolCallLabels = (t: TFn): Record<string, string> => ({
  // biome-ignore lint/style/useNamingConvention: key matches server tool name
  list_materials: t('KbChat.tool.listMaterials', '查看可用材料'),
  // biome-ignore lint/style/useNamingConvention: key matches server tool name
  read_material: t('KbChat.tool.readMaterial', '读取材料'),
  // biome-ignore lint/style/useNamingConvention: key matches server tool name
  search_material: t('KbChat.tool.searchMaterial', '搜索材料'),
  // biome-ignore lint/style/useNamingConvention: key matches server tool name
  search_knowledge_base: t('KbChat.tool.searchKb', '搜索知识库'),
  // biome-ignore lint/style/useNamingConvention: key matches page tool name
  page_list_actions: t('KbChat.tool.pageListActions', '浏览页面操作'),
  // biome-ignore lint/style/useNamingConvention: key matches page tool name
  page_get_action_detail: t('KbChat.tool.pageGetActionDetail', '查看操作详情'),
  // biome-ignore lint/style/useNamingConvention: key matches page tool name
  page_query_table: t('KbChat.tool.pageQueryTable', '查询表格数据'),
  // biome-ignore lint/style/useNamingConvention: key matches page tool name
  page_execute_action: t('KbChat.tool.pageExecuteAction', '执行页面操作'),
  // biome-ignore lint/style/useNamingConvention: key matches page tool name
  page_get_form_values: t('KbChat.tool.pageGetFormValues', '获取表单数据'),
  // biome-ignore lint/style/useNamingConvention: key matches global tool name
  list_available_pages: t('KbChat.tool.listAvailablePages', '查看可用页面'),
  // biome-ignore lint/style/useNamingConvention: key matches global tool name
  navigate_to_page: t('KbChat.tool.navigateToPage', '导航到页面'),
});

const createPhaseLabelMap = (
  t: TFn,
): Record<string, (detail: Record<string, unknown>) => string> => ({
  // biome-ignore lint/style/useNamingConvention: key matches server enum variant
  MaterialProcessing: (detail) => {
    const d = detail as { totalChunks?: number | null };
    return d.totalChunks != null
      ? t(
          'KbChat.phase.materialProcessingCount',
          '正在处理材料 ({{count}} 片段)',
          { count: d.totalChunks },
        )
      : t('KbChat.phase.materialProcessing', '正在处理材料...');
  },
  // biome-ignore lint/style/useNamingConvention: key matches server enum variant
  GeneratingAnswer: () => t('KbChat.phase.generatingAnswer', '正在生成回答...'),
  // biome-ignore lint/style/useNamingConvention: key matches server enum variant
  Persisting: () => t('KbChat.phase.persisting', '正在保存...'),
});

const inlineTextThreshold = 1500;

const remarkPlugins = [remarkGfm];

let messageKeyCounter = 0;
const nextMsgKey = () => `msg-${++messageKeyCounter}-${Date.now()}`;

// ─── Helper: download blob ──────────────────────────────

const downloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};

// ─── Helper: format time divider ────────────────────────

const formatTimeDivider = (dateStr: string): string => {
  const d = dayjs(dateStr);
  const today = dayjs();
  const isToday = d.format('YYYY-MM-DD') === today.format('YYYY-MM-DD');
  const prefix = isToday ? '今天' : d.format('MM/DD');
  return `${prefix} ${d.format('HH:mm')}`;
};

// ─── Sub: Page Context Popover ───────────────────────────

/** Serialize capabilities for display, replacing functions with signatures. */
const serializeCaps = (caps: Record<string, unknown>): string => {
  const replacer = (_key: string, value: unknown): unknown => {
    if (typeof value === 'function') {
      return `[Function: ${value.name || 'anonymous'}]`;
    }
    return value;
  };
  return JSON.stringify(caps, replacer, 2);
};

const PageContextPopover = memo(() => {
  const t = useT();
  const [open, setOpen] = useState(false);
  const capabilities = useAgentStore((s) => s.capabilities);

  const formatted = useMemo(() => {
    if (!capabilities) return null;
    return serializeCaps(capabilities as unknown as Record<string, unknown>);
  }, [capabilities]);

  return (
    <div className="relative">
      <button
        type="button"
        className={cn(
          'size-7 grid place-items-center rounded-md border-none bg-transparent cursor-pointer transition-all',
          open
            ? 'bg-accent text-foreground'
            : 'text-muted-foreground hover:bg-accent hover:text-foreground',
          !capabilities && 'opacity-40 pointer-events-none',
        )}
        title={t('KbChat.pageContext.title', '页面元数据')}
        onClick={() => setOpen((prev) => !prev)}
      >
        <Icon icon="lucide:info" className="size-4" />
      </button>
      {open && (
        <>
          {/* Backdrop */}
          {/* biome-ignore lint/a11y/noStaticElementInteractions: click-outside backdrop */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
            onKeyDown={() => {}}
            role="presentation"
          />
          {/* Popover */}
          <div className="absolute right-0 top-full mt-1 z-50 w-[400px] max-h-[500px] overflow-y-auto rounded-md border bg-card shadow-lg">
            <div className="flex items-center justify-between px-3 py-2 border-b">
              <span className="text-xs font-medium text-muted-foreground">
                {t('KbChat.pageContext.capabilities', '当前页面能力')}
              </span>
              <button
                type="button"
                className="size-5 grid place-items-center rounded text-muted-foreground hover:text-foreground bg-transparent border-none cursor-pointer"
                onClick={() => setOpen(false)}
              >
                <Icon icon="lucide:x" className="size-3" />
              </button>
            </div>
            <pre className="p-3 text-[11px] font-mono leading-relaxed text-muted-foreground whitespace-pre-wrap break-all">
              {formatted ??
                t('KbChat.pageContext.noCapabilities', '无页面能力注册')}
            </pre>
          </div>
        </>
      )}
    </div>
  );
});

// ─── Sub: Empty State ───────────────────────────────────

const EmptyState = memo(({ placeholder }: { placeholder: string }) => (
  <div className="flex flex-1 flex-col items-center justify-center gap-4 text-muted-foreground">
    <div className="flex size-16 items-center justify-center rounded-2xl bg-linear-to-br from-teal-500 to-teal-600 shadow-lg animate-pulse">
      <Icon icon="lucide:message-square" className="size-8 text-white" />
    </div>
    <p className="text-sm">{placeholder}</p>
  </div>
));

// ─── Sub: Tool Call Block ───────────────────────────────

const ToolCallBlock = memo(
  ({ part, labels }: { part: ContentPart; labels: Record<string, string> }) => {
    const [expanded, setExpanded] = useState(false);
    const isCompleted = part.status === 'completed';
    const label = labels[part.toolName ?? ''] ?? part.toolName ?? '';
    let duration: string | undefined;
    if (part.durationMs != null) {
      duration =
        part.durationMs < 1000
          ? `${part.durationMs}ms`
          : `${(part.durationMs / 1000).toFixed(1)}s`;
    }

    return (
      <div
        className={cn(
          'flex flex-col py-1 pl-3 border-l-2 transition-colors duration-200',
          isCompleted
            ? 'border-l-emerald-300 dark:border-l-emerald-700 hover:border-l-teal-400 dark:hover:border-l-teal-500'
            : 'border-l-teal-400 dark:border-l-teal-500 hover:border-l-teal-500 dark:hover:border-l-teal-400',
        )}
      >
        <button
          type="button"
          className="flex items-center gap-2 cursor-pointer select-none min-h-6.5 py-1 text-left bg-transparent border-none w-full"
          onClick={() => setExpanded(!expanded)}
        >
          <span className="font-mono text-xs font-medium bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-300 px-2 py-0.5 rounded whitespace-nowrap">
            {label}
          </span>
          {duration != null && (
            <span className="font-mono text-[11px] text-muted-foreground">
              {duration}
            </span>
          )}
          {!isCompleted && (
            <span className="inline-block size-2.5 border-[1.5px] border-emerald-200 dark:border-emerald-700 border-t-teal-500 dark:border-t-teal-400 rounded-full animate-spin" />
          )}
          {isCompleted && !expanded && (
            <span className="text-muted-foreground">
              <Icon icon="lucide:chevron-down" className="size-3 opacity-50" />
            </span>
          )}
          {expanded && (
            <span className="text-muted-foreground">
              <Icon icon="lucide:chevron-up" className="size-3" />
            </span>
          )}
        </button>
        {isCompleted && (
          <span className="flex items-start gap-1 text-xs text-muted-foreground mt-0.5 pl-0.5 leading-relaxed min-w-0">
            {!expanded && (
              <Icon
                icon="lucide:check"
                className="size-2.5 text-emerald-500 shrink-0 mt-0.5"
              />
            )}
            {!expanded && (
              <span className="truncate">{part.resultPreview ?? ''}</span>
            )}
          </span>
        )}
        <div
          className={cn(
            'overflow-hidden transition-all duration-250',
            expanded ? 'max-h-100 opacity-100 mt-2' : 'max-h-0 opacity-0',
          )}
        >
          <div className="rounded-md border bg-card p-3 font-mono text-xs leading-relaxed text-muted-foreground max-h-50 overflow-y-auto shadow-xs">
            {part.resultPreview ?? ''}
          </div>
        </div>
      </div>
    );
  },
);

// ─── Sub: User Message ──────────────────────────────────

const UserMessage = memo(
  ({
    msg,
    t,
    onCopyRound,
  }: {
    msg: UiMessage;
    t: TFn;
    onCopyRound?: () => void;
  }) => (
    <div className="group/user-msg flex flex-col items-end gap-1 mb-3">
      <div className="max-w-[82%] flex flex-col gap-2 rounded-xl rounded-br-sm bg-user-bubble text-white px-4 py-3 text-sm leading-relaxed shadow-sm">
        {/* Inline text attachment */}
        {msg.materialType === 'inline' && msg.inlineText && (
          <div className="rounded-md bg-white/15 border border-white/20 p-3">
            <div className="flex items-center gap-2 mb-1">
              <Icon icon="lucide:file-text" className="size-3.5" />
              <span className="text-xs font-medium">
                {t('KbChat.material.pastedText', '粘贴文本')}
              </span>
              <span className="inline-flex px-1.5 rounded-full bg-white/18 text-white/75 text-[10px] font-medium">
                {msg.inlineText.length} {t('KbChat.material.charCount', '字符')}
              </span>
            </div>
            <div className="text-[11px] font-mono opacity-60 leading-snug max-h-[2.4em] overflow-hidden whitespace-pre-wrap line-clamp-2">
              {msg.inlineText}
            </div>
          </div>
        )}
        {/* File attachments */}
        {msg.fileNames.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-1">
            {msg.fileNames.map((name) => (
              <div
                key={name}
                className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-white/10 border border-white/15 max-w-65 min-w-0"
              >
                <div className="size-7 rounded bg-white/15 grid place-items-center shrink-0">
                  <Icon icon="lucide:file-text" className="size-3.5" />
                </div>
                <span className="text-xs font-medium truncate">{name}</span>
              </div>
            ))}
          </div>
        )}
        <span>{msg.content}</span>
      </div>
      {onCopyRound && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 opacity-0 group-hover/user-msg:opacity-100 transition-opacity"
              onClick={onCopyRound}
            >
              <Icon icon="lucide:copy" className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left">
            {t('KbChat.copyRound', '复制本轮对话')}
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  ),
);

// ─── Sub: AI Message ────────────────────────────────────

const AiMessageInner = ({
  msg,
  t,
  labels,
}: {
  msg: UiMessage;
  t: (key: string, fallback: string) => string;
  labels: Record<string, string>;
}) => (
  <div className="flex gap-3 items-start mb-3">
    <div className="size-6.5 rounded-md bg-linear-to-br from-teal-500 to-teal-600 grid place-items-center shrink-0 mt-0.5">
      <Icon icon="lucide:layers" className="size-3.5 text-white" />
    </div>
    <div className="flex-1 min-w-0 flex flex-col">
      {msg.loading && msg.parts.length === 0 && !msg.content && (
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <span className="inline-block size-2 border-[1.5px] border-emerald-200 dark:border-emerald-700 border-t-teal-500 dark:border-t-teal-400 rounded-full animate-spin" />
          <span>{msg.phase ?? t('KbChat.thinking', '思考中...')}</span>
        </div>
      )}
      {msg.parts.length > 0 &&
        msg.parts.map((part, idx) => {
          const partKey =
            part.type === 'tool_call'
              ? `tc-${part.toolCallId ?? idx}`
              : `txt-${part.createdAt ?? part.content?.slice(0, 20) ?? idx}`;
          if (part.type === 'tool_call') {
            return <ToolCallBlock key={partKey} part={part} labels={labels} />;
          }
          // text part
          if (!part.content) return null;
          return (
            <div
              key={partKey}
              className="text-sm leading-relaxed text-foreground prose prose-sm max-w-none prose-strong:text-foreground prose-em:bg-gradient-to-t prose-em:from-amber-200/60 dark:prose-em:from-amber-500/30 prose-em:to-transparent prose-em:px-0.5 prose-em:font-medium prose-em:not-italic prose-headings:text-foreground prose-headings:font-semibold"
            >
              <Markdown remarkPlugins={remarkPlugins}>{part.content}</Markdown>
            </div>
          );
        })}
      {!msg.loading && msg.content && msg.parts.length === 0 && (
        <div className="text-sm leading-relaxed text-foreground prose prose-sm max-w-none prose-strong:text-foreground prose-em:bg-gradient-to-t prose-em:from-amber-200/60 dark:prose-em:from-amber-500/30 prose-em:to-transparent prose-em:px-0.5 prose-em:font-medium prose-em:not-italic">
          <Markdown remarkPlugins={remarkPlugins}>{msg.content}</Markdown>
        </div>
      )}
    </div>
  </div>
);
const AiMessage = memo(AiMessageInner);

// ─── Round Markdown Formatter ────────────────────────────

const formatRoundMarkdown = (round: {
  userMsg?: UiMessage;
  aiMsg?: UiMessage;
}): string => {
  const sections: string[] = [];

  if (round.userMsg) {
    sections.push(`## 用户\n\n${round.userMsg.content}`);
  }

  if (round.aiMsg) {
    const parts: string[] = [];

    for (const part of round.aiMsg.parts) {
      if (part.type === 'text' && part.content) {
        parts.push(part.content);
      } else if (part.type === 'tool_call') {
        const name = part.toolName ?? 'unknown';
        const duration =
          part.durationMs != null ? ` (${part.durationMs}ms)` : '';
        const preview = part.resultPreview
          ? `\n> \`${part.resultPreview.slice(0, 200)}\``
          : '';
        parts.push(
          `> **🔍 ${name}**${duration}${preview}\n> **参数:**\n> \`—\``,
        );
      }
    }

    const body = parts.length > 0 ? parts.join('\n\n') : round.aiMsg.content;

    sections.push(`## 助手\n\n${body ?? ''}`);
  }

  return sections.join('\n\n---\n\n');
};

// ─── Sub: Time Divider ──────────────────────────────────

const TimeDividerInner = ({ label }: { label: string }) => (
  <div className="flex items-center gap-3 my-4">
    <div className="flex-1 h-px bg-border" />
    <span className="text-[11px] text-muted-foreground font-medium tracking-wide whitespace-nowrap">
      {label}
    </span>
    <div className="flex-1 h-px bg-border" />
  </div>
);
const TimeDivider = memo(TimeDividerInner);

// ─── Sub: Session Item ──────────────────────────────────

const SessionItemInner = ({
  session,
  isActive,
  onSelect,
  deleteConfirmId,
  onDeleteConfirm,
  onDeleteCancel,
  onDeleteRequest,
  t,
}: {
  session: ChatSession;
  isActive: boolean;
  onSelect: () => void;
  deleteConfirmId: string | undefined;
  onDeleteConfirm: () => void;
  onDeleteCancel: () => void;
  onDeleteRequest: () => void;
  t: TFn;
}) => (
  // biome-ignore lint/a11y/useSemanticElements: contains nested buttons, cannot use <button>
  <div
    role="button"
    tabIndex={0}
    className={cn(
      'group flex w-full items-center gap-2 px-3 py-2 rounded-md cursor-pointer transition-colors relative text-left',
      isActive ? 'bg-orange-50 dark:bg-orange-900/25' : 'hover:bg-accent',
    )}
    onClick={onSelect}
    onKeyDown={(e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onSelect();
      }
    }}
  >
    <span
      className={cn(
        'flex-1 min-w-0 text-xs truncate',
        isActive
          ? 'text-orange-700 dark:text-orange-400 font-medium'
          : 'text-foreground',
      )}
    >
      {session.title ?? t('KbChat.session.untitled', '未命名')}
    </span>
    <button
      type="button"
      className="size-5.5 grid place-items-center rounded border-none bg-transparent text-muted-foreground shrink-0 opacity-0 group-hover:opacity-100 transition-all hover:bg-red-50 dark:hover:bg-red-900/30 hover:text-red-600 dark:hover:text-red-400 cursor-pointer"
      onClick={(e) => {
        e.stopPropagation();
        onDeleteRequest();
      }}
    >
      <Icon icon="lucide:trash-2" className="size-3" />
    </button>
    {/* Delete confirmation popover */}
    {deleteConfirmId === session.id && (
      <div
        role="dialog"
        aria-label={t('KbChat.session.confirmDelete', '确认删除')}
        className="absolute right-0 top-full translate-y-0.5 bg-card border border-border rounded-md p-3 shadow-md z-50 whitespace-nowrap text-xs text-muted-foreground"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <div className="mb-2 leading-relaxed">
          {t('KbChat.session.confirmDeleteMsg', '确认删除该会话？')}
        </div>
        <div className="flex gap-2 justify-end">
          <button
            type="button"
            className="px-3 py-0.5 rounded bg-muted text-muted-foreground text-xs border-none cursor-pointer hover:bg-accent"
            onClick={(e) => {
              e.stopPropagation();
              onDeleteCancel();
            }}
          >
            {t('Common.cancel', '取消')}
          </button>
          <button
            type="button"
            className="px-3 py-0.5 rounded bg-red-600 text-white text-xs border-none cursor-pointer hover:bg-red-700"
            onClick={(e) => {
              e.stopPropagation();
              onDeleteConfirm();
            }}
          >
            {t('Common.confirm', '确认')}
          </button>
        </div>
      </div>
    )}
  </div>
);
const SessionItem = memo(SessionItemInner);

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
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | undefined>();

  const abortRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesAreaRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollReasonRef = useRef<'bottom' | 'top' | null>(null);
  const scrollToMsgKeyRef = useRef<string | null>(null);

  const navigate = useNavigate();
  const { data: menuTree } = useRequest(getUserMenus, { manual: false });

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
          const materialType = inlineRef ? ('inline' as const) : undefined;
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
            phase: undefined,
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
      setActiveSessionId(session.id);
      setSessionListOpen(false);
      setDeleteConfirmId(undefined);
      loadSessionMessages(session.id);
    },
    [loadSessionMessages],
  );

  const handleNewChat = useCallback(() => {
    scrollReasonRef.current = null;
    setActiveSessionId(undefined);
    setMessages([]);
    setDeleteConfirmId(undefined);
  }, []);

  const handleDeleteSession = useCallback(
    (id: string) => {
      deleteChatSession(id).then(() => {
        toast.success(t('KbChat.session.deleted', '会话已删除'));
        setSessions((prev) => prev.filter((s) => s.id !== id));
        if (activeSessionId === id) {
          setActiveSessionId(undefined);
          setMessages([]);
        }
        setDeleteConfirmId(undefined);
      });
    },
    [activeSessionId, t],
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

    // Build user message
    let materialType: UiMessage['materialType'];
    if (inlineText) {
      materialType = 'inline';
    } else if (attachedFiles.length > 0) {
      materialType = 'file';
    }

    const userMsg: UiMessage = {
      key: nextMsgKey(),
      role: 'user',
      content: text,
      parts: [],
      loading: false,
      hasMaterial: attachedFiles.length > 0 || !!inlineText,
      materialType,
      fileName: undefined,
      inlineText,
      phase: undefined,
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
        phase: undefined,
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
    const material =
      inlineText || attachedFiles.length > 0
        ? {
            inline: inlineText,
            fileIds:
              attachedFiles.length > 0
                ? attachedFiles.map((f) => f.id)
                : undefined,
          }
        : undefined;

    const abort = new AbortController();
    abortRef.current = abort;
    setIsStreaming(true);

    // Capture pages map + active route snapshot for this request.
    const { pages, activeRoute } = useAgentStore.getState();

    const request: {
      instruction: string;
      material?: {
        inline?: string;
        fileIds?: string[];
      };
      sessionId?: string;
      pageTools?: ReturnType<typeof generatePageToolSchemas>;
      pageContext?: ReturnType<typeof generatePageContext>[];
    } = {
      instruction: text,
      material,
      sessionId: activeSessionId,
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

        const handleEvent: Record<string, (ev: QaStreamEvent) => void> = {
          // biome-ignore lint/style/useNamingConvention: key matches SSE event type
          Started: (ev) => {
            const e = ev as { type: 'Started'; data: { sessionId: string } };
            setActiveSessionId(e.data.sessionId);
          },
          // biome-ignore lint/style/useNamingConvention: key matches SSE event type
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
          // biome-ignore lint/style/useNamingConvention: key matches SSE event type
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
          // biome-ignore lint/style/useNamingConvention: key matches SSE event type
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
          // biome-ignore lint/style/useNamingConvention: key matches SSE event type
          AnswerToken: (ev) => {
            const e = ev as {
              type: 'AnswerToken';
              data: { token: string };
            };
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
          // biome-ignore lint/style/useNamingConvention: key matches SSE event type
          Completed: () => {
            assistant.loading = false;
            setIsStreaming(false);
            abortRef.current = null;
            // Refresh sessions list since a new one might have been created
            loadSessions();
          },
          // biome-ignore lint/style/useNamingConvention: key matches SSE event type
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
    activeSessionId,
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
                  <AiMessage msg={round.aiMsg} t={t} labels={toolCallLabels} />
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
        {/* Material indicators */}
        {(attachedFiles.length > 0 || inlineText) && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {attachedFiles.map((f) => (
              <span
                key={f.id}
                className="file-chip-emerald inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800"
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
