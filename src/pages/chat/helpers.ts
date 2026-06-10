import dayjs from 'dayjs';
import remarkGfm from 'remark-gfm';
import type { KbFolder } from '@/api/knowledge-base';
import { listFolders } from '@/api/knowledge-base';
import type { TFn } from '@/i18n';
import type { MaterialRefs, UiMessage } from './types';

export const allKnowledgeScopeValue = '__all__';
export const noKnowledgeScopeValue = '__none__';
export const wholeLibraryFolderValue = '__whole_library__';
export const inlineTextThreshold = 1500;
export const remarkPlugins = [remarkGfm];

let messageKeyCounter = 0;

export const nextMsgKey = () => `msg-${++messageKeyCounter}-${Date.now()}`;

export const createToolCallLabels = (t: TFn): Record<string, string> => ({
  // biome-ignore lint/style/useNamingConvention: key matches server tool name
  list_materials: t('KbChat.tool.listMaterials', '查看可用材料'),
  // biome-ignore lint/style/useNamingConvention: key matches server tool name
  read_material: t('KbChat.tool.readMaterial', '读取材料'),
  // biome-ignore lint/style/useNamingConvention: key matches server tool name
  search_material: t('KbChat.tool.searchMaterial', '搜索材料'),
  // biome-ignore lint/style/useNamingConvention: key matches server tool name
  search_knowledge_base: t('KbChat.tool.searchKb', '搜索知识库'),
  // biome-ignore lint/style/useNamingConvention: key matches server tool name
  read_knowledge_base_lines: t(
    'KbChat.tool.readKnowledgeBaseLines',
    '读取知识库原文',
  ),
  // biome-ignore lint/style/useNamingConvention: key matches server tool name
  list_knowledge_base_documents: t(
    'KbChat.tool.listKnowledgeBaseDocuments',
    '查看知识库文档',
  ),
  // biome-ignore lint/style/useNamingConvention: key matches server tool name
  list_knowledge_base_scope: t(
    'KbChat.tool.listKnowledgeBaseScope',
    '查看知识库范围',
  ),
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

export const createPhaseLabelMap = (
  t: TFn,
): Record<string, (detail: Record<string, unknown>) => string> => ({
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
  GeneratingAnswer: () => t('KbChat.phase.generatingAnswer', '正在生成回答...'),
  Persisting: () => t('KbChat.phase.persisting', '正在保存...'),
});

export const buildKnowledgeScopeLabel = (refs: MaterialRefs, t: TFn) => {
  if (refs?.knowledgeScopeLabel) return refs.knowledgeScopeLabel;
  if (refs?.folderId) {
    return refs.includeSubfolders
      ? t(
          'KbChat.material.folderScopeWithChildren',
          '知识库目录范围（含子目录）',
        )
      : t(
          'KbChat.material.folderScopeCurrentOnly',
          '知识库目录范围（仅当前目录）',
        );
  }
  if (refs?.libraryId) {
    return t('KbChat.material.libraryScope', '知识库范围');
  }
  return undefined;
};

export const resolveMaterialType = (
  inlineRef: unknown,
  scopeLabel: string | undefined,
): UiMessage['materialType'] => {
  if (inlineRef) return 'inline';
  if (scopeLabel) return 'knowledge';
  return undefined;
};

export const loadLibraryFolders = async (libraryId: string) => {
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
  return all;
};

export const downloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};

export const formatTimeDivider = (dateStr: string): string => {
  const d = dayjs(dateStr);
  const today = dayjs();
  const isToday = d.format('YYYY-MM-DD') === today.format('YYYY-MM-DD');
  const prefix = isToday ? '今天' : d.format('MM/DD');
  return `${prefix} ${d.format('HH:mm')}`;
};

export const formatRoundMarkdown = (round: {
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
