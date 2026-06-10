import { Icon } from '@iconify/react';
import { memo, useMemo, useState } from 'react';
import Markdown from 'react-markdown';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import type { TFn } from '@/i18n';
import { useT } from '@/i18n';
import { cn } from '@/lib/utils';
import { useAgentStore } from '@/stores/agent';
import { remarkPlugins } from './helpers';
import type { ContentPart, UiMessage } from './types';

export const PageContextPopover = memo(() => {
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
          {/* biome-ignore lint/a11y/noStaticElementInteractions: click-outside backdrop */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
            onKeyDown={() => {}}
            role="presentation"
          />
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

export const EmptyState = memo(({ placeholder }: { placeholder: string }) => (
  <div className="flex flex-1 flex-col items-center justify-center gap-4 text-muted-foreground">
    <div className="flex size-16 items-center justify-center rounded-2xl bg-linear-to-br from-teal-500 to-teal-600 shadow-lg animate-pulse">
      <Icon icon="lucide:message-square" className="size-8 text-white" />
    </div>
    <p className="text-sm">{placeholder}</p>
  </div>
));

export const ToolCallBlock = memo(
  ({ part, labels }: { part: ContentPart; labels: Record<string, string> }) => {
    const [expanded, setExpanded] = useState(false);
    const isCompleted = part.status === 'completed';
    const label = labels[part.toolName ?? ''] ?? part.toolName ?? '';
    const duration = formatDuration(part.durationMs);

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
          <span className="text-muted-foreground">
            <Icon
              icon={expanded ? 'lucide:chevron-up' : 'lucide:chevron-down'}
              className={cn('size-3', !expanded && 'opacity-50')}
            />
          </span>
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

export const UserMessage = memo(
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
        {msg.knowledgeScopeLabel && (
          <div className="flex items-center gap-2 rounded-md border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-medium">
            <Icon icon="lucide:library" className="size-3.5" />
            <span className="truncate">{msg.knowledgeScopeLabel}</span>
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

export const AiMessage = memo(
  ({
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
              return (
                <ToolCallBlock key={partKey} part={part} labels={labels} />
              );
            }
            if (!part.content) return null;
            return (
              <div
                key={partKey}
                className="text-sm leading-relaxed text-foreground prose prose-sm max-w-none prose-strong:text-foreground prose-em:bg-gradient-to-t prose-em:from-amber-200/60 dark:prose-em:from-amber-500/30 prose-em:to-transparent prose-em:px-0.5 prose-em:font-medium prose-em:not-italic prose-headings:text-foreground prose-headings:font-semibold"
              >
                <Markdown remarkPlugins={remarkPlugins}>
                  {part.content}
                </Markdown>
              </div>
            );
          })}
        {!msg.loading && msg.content && msg.parts.length === 0 && (
          <div className="text-sm leading-relaxed text-foreground prose prose-sm max-w-none prose-strong:text-foreground prose-em:bg-gradient-to-t prose-em:from-amber-200/60 dark:prose-em:from-amber-500/30 prose-em:to-transparent prose-em:px-0.5 prose-em:font-medium prose-em:not-italic">
            <Markdown remarkPlugins={remarkPlugins}>{msg.content}</Markdown>
          </div>
        )}
        {msg.citations.length > 0 && (
          <div className="mt-2 rounded-md border bg-muted/30 p-2">
            <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Icon icon="lucide:quote" className="size-3.5" />
              {t('KbChat.citations.title', '引用来源')}
            </div>
            <div className="space-y-1.5">
              {msg.citations.slice(0, 5).map((citation, idx) => {
                const locationLabel = formatCitationLocation(citation);
                const preview = shouldShowCitationPreview(citation)
                  ? citation.content
                  : undefined;

                return (
                  <div
                    key={`${citation.documentId}-${citation.chunkId ?? idx}`}
                    className="rounded border bg-background/70 px-2.5 py-2 text-xs"
                  >
                    <div className="flex min-w-0 items-start gap-2">
                      <Icon
                        icon="lucide:file-text"
                        className="mt-0.5 size-3.5 shrink-0 text-teal-600 dark:text-teal-400"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium text-foreground">
                          {citation.documentTitle
                            ? `《${citation.documentTitle}》`
                            : (citation.headingPath ??
                              t(
                                'KbChat.citations.unknownDocument',
                                '未知文档',
                              ))}
                        </div>
                        {citation.headingPath && citation.documentTitle && (
                          <div className="mt-0.5 truncate text-muted-foreground">
                            {citation.headingPath}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-muted-foreground">
                      <span className="inline-flex items-center gap-1 rounded bg-teal-50 px-1.5 py-0.5 text-teal-700 dark:bg-teal-950/40 dark:text-teal-300">
                        <Icon icon="lucide:map-pin" className="size-3" />
                        {locationLabel}
                      </span>
                      <span className="font-mono">
                        {t('KbChat.citations.document', '文档')}:{' '}
                        {citation.documentId.slice(0, 8)}
                      </span>
                      {citation.chunkId && (
                        <span className="font-mono">
                          {t('KbChat.citations.chunk', '分块')}:{' '}
                          {citation.chunkId.slice(0, 8)}
                        </span>
                      )}
                      <span className="font-mono">
                        {t('KbChat.citations.score', '相关度')}:{' '}
                        {citation.score.toFixed(2)}
                      </span>
                    </div>
                    {preview && (
                      <div className="mt-1.5 line-clamp-2 text-muted-foreground">
                        {preview}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  ),
);

export const TimeDivider = memo(({ label }: { label: string }) => (
  <div className="flex items-center gap-3 my-4">
    <div className="flex-1 h-px bg-border" />
    <span className="text-[11px] text-muted-foreground font-medium tracking-wide whitespace-nowrap">
      {label}
    </span>
    <div className="flex-1 h-px bg-border" />
  </div>
));

export const SessionItem = memo(
  ({
    session,
    isActive,
    onSelect,
    deleteConfirmId,
    onDeleteConfirm,
    onDeleteCancel,
    onDeleteRequest,
    t,
  }: {
    session: { id: string; title?: string | null };
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
  ),
);

const serializeCaps = (caps: Record<string, unknown>): string => {
  const replacer = (_key: string, value: unknown): unknown => {
    if (typeof value === 'function') {
      return `[Function: ${value.name || 'anonymous'}]`;
    }
    return value;
  };
  return JSON.stringify(caps, replacer, 2);
};

const formatDuration = (durationMs: number | undefined) => {
  if (durationMs == null) return undefined;
  return durationMs < 1000
    ? `${durationMs}ms`
    : `${(durationMs / 1000).toFixed(1)}s`;
};

const formatCitationLocation = (citation: {
  startLine?: number | null;
  endLine?: number | null;
}) => {
  if (!citation.startLine) return '位置未知';
  if (!citation.endLine || citation.endLine === citation.startLine) {
    return `第 ${citation.startLine} 行`;
  }
  return `第 ${citation.startLine}-${citation.endLine} 行`;
};

const shouldShowCitationPreview = (citation: {
  content?: string | null;
  headingPath?: string | null;
}) => {
  const content = citation.content?.trim();
  if (!content) return false;
  return content !== citation.headingPath?.trim();
};
