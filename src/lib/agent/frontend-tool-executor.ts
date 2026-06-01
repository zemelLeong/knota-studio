import type { TFn } from '@/i18n';
import type { PageCapabilities } from '@/stores/agent';
import type { MergedMenuTreeResponse } from '@/types/api';

// ─── Types ──────────────────────────────────────────────────────

export interface ToolCallResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

/** Dependencies needed by global tools. */
export interface GlobalToolDeps {
  menuTree: MergedMenuTreeResponse[];
  navigate: (path: string) => void;
}

// ─── Helpers ────────────────────────────────────────────────────

/** Check if a tool name is a frontend page tool. */
export const isFrontendTool = (toolName: string): boolean =>
  toolName.startsWith('page_');

// ─── Handlers ───────────────────────────────────────────────────

const handleListActions = async (
  capabilities: PageCapabilities,
): Promise<ToolCallResult> => {
  const actionsOverview = capabilities.actions.map((action) => ({
    actionKey: action.actionKey,
    label: action.label,
    description: action.description,
    paramSource: action.formId ? 'form' : 'explicit',
    ...(action.formId ? { formId: action.formId } : {}),
    ...(action.mode ? { mode: action.mode } : {}),
  }));

  const tablesOverview = capabilities.tables.map((table) => ({
    tableId: table.tableId,
    columns: table.columns.map((col) => ({
      key: col.key,
      label: col.label,
      ...(col.description ? { description: col.description } : {}),
    })),
    filterFields: table.filterFields.map((f) => ({
      key: f.name,
      label: f.label,
    })),
  }));

  return {
    success: true,
    data: { actions: actionsOverview, tables: tablesOverview },
  };
};

const handleGetActionDetail = async (
  args: Record<string, unknown>,
  capabilities: PageCapabilities,
): Promise<ToolCallResult> => {
  const actionKey = args.actionKey as string;
  const action = capabilities.actions.find((a) => a.actionKey === actionKey);

  if (!action) {
    return { success: false, error: `Action not found: ${actionKey}` };
  }

  const paramSource = action.formId ? 'form' : 'explicit';

  let fields: Record<string, unknown>[];
  if (action.fields) {
    fields = action.fields.map((field) => ({
      name: field.name,
      label: field.label,
      type: field.type,
      required: field.required ?? false,
      ...(field.options ? { options: field.options } : {}),
    }));
  } else if (action.formId) {
    const form = capabilities.forms.find((f) => f.formId === action.formId);
    fields =
      form?.fields.map((field) => ({
        name: field.name,
        label: field.label,
        type: field.type,
        required: field.required ?? false,
        ...(field.options ? { options: field.options } : {}),
      })) ?? [];
  } else {
    fields = (action.params ?? []).map((param) => ({
      name: param.name,
      label: param.label,
      type: param.type,
      required: param.required,
      ...(param.options ? { options: param.options } : {}),
      ...(param.description ? { description: param.description } : {}),
    }));
  }

  return {
    success: true,
    data: {
      actionKey: action.actionKey,
      label: action.label,
      description: action.description,
      paramSource,
      ...(action.formId ? { formId: action.formId } : {}),
      ...(action.mode ? { mode: action.mode } : {}),
      fields,
    },
  };
};

const handleQueryTable = async (
  args: Record<string, unknown>,
  capabilities: PageCapabilities,
): Promise<ToolCallResult> => {
  const tableId = args.tableId as string | undefined;
  const table = tableId
    ? capabilities.tables.find((t) => t.tableId === tableId)
    : capabilities.tables[0];
  if (!table) {
    const available = capabilities.tables.map((t) => t.tableId).join(', ');
    return {
      success: false,
      error: tableId
        ? `Table not found: ${tableId}. Available: ${available}`
        : 'No table available on this page',
    };
  }

  if (!table.loader) {
    return { success: false, error: 'Table has no data loader' };
  }

  // Flatten `filter` object into top-level params so the loader can read
  // filter fields directly (e.g. args.emptyLocale instead of args.filter.emptyLocale).
  const { filter, ...rest } = args;
  const flatArgs =
    filter && typeof filter === 'object'
      ? { ...rest, ...(filter as Record<string, unknown>) }
      : rest;

  const result = await table.loader(flatArgs);
  return { success: true, data: result };
};

const handleExecuteAction = async (
  args: Record<string, unknown>,
  capabilities: PageCapabilities,
  t: TFn,
): Promise<ToolCallResult> => {
  const actionKey = args.actionKey as string;
  const action = capabilities.actions.find((a) => a.actionKey === actionKey);

  if (!action) {
    return { success: false, error: `Action not found: ${actionKey}` };
  }

  try {
    const result = await action.execute(
      (args.params as Record<string, unknown>) ?? {},
    );
    if (action.query) {
      return { success: true, data: result };
    }
    return {
      success: true,
      data: { message: t('Agent.executeSuccess', '操作执行成功') },
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { success: false, error: message };
  }
};

const handleGetFormValues = async (
  args: Record<string, unknown>,
  capabilities: PageCapabilities,
): Promise<ToolCallResult> => {
  const formId = args.formId as string;
  const form = capabilities.forms.find((f) => f.formId === formId);

  if (!form) {
    return { success: false, error: `Form not found: ${formId}` };
  }

  if (!form.loader) {
    return {
      success: false,
      error: `Form ${formId} has no loader (cannot load values)`,
    };
  }

  const result = await form.loader(args.id as string | undefined);
  return { success: true, data: result ? { values: result } : null };
};

// ─── Executor ───────────────────────────────────────────────────

/**
 * Execute a frontend page tool call.
 * Resolves the target page from args.targetPage or activeRoute, then routes
 * to the appropriate handler based on tool name.
 */
export const executeFrontendTool = async (
  toolName: string,
  args: Record<string, unknown>,
  pages: Map<string, PageCapabilities>,
  activeRoute: string | null,
  t: TFn,
): Promise<ToolCallResult> => {
  const targetRoute = (args.targetPage as string) ?? activeRoute;

  if (!targetRoute) {
    return {
      success: false,
      error: t('Agent.noTargetPage', '未指定目标页面且无当前页面'),
    };
  }

  const capabilities = pages.get(targetRoute);
  if (!capabilities) {
    return {
      success: false,
      error: t('Agent.pageNotRegistered', `页面 ${targetRoute} 未注册或已过期`),
    };
  }

  const handlerMap = new Map<string, () => Promise<ToolCallResult>>([
    ['page_list_actions', () => handleListActions(capabilities)],
    ['page_get_action_detail', () => handleGetActionDetail(args, capabilities)],
    ['page_query_table', () => handleQueryTable(args, capabilities)],
    ['page_execute_action', () => handleExecuteAction(args, capabilities, t)],
    ['page_get_form_values', () => handleGetFormValues(args, capabilities)],
  ]);

  const handler = handlerMap.get(toolName);
  if (!handler) {
    return { success: false, error: `Unknown frontend tool: ${toolName}` };
  }
  return handler();
};

// ─── Global Tool Helpers ────────────────────────────────────────

/** Flatten menu tree into a flat list of pages with paths. */
const flattenMenuTree = (
  items: MergedMenuTreeResponse[],
): { path: string; name: string }[] =>
  items.flatMap((item) => [
    ...(item.path ? [{ path: item.path, name: item.name }] : []),
    ...flattenMenuTree(item.children),
  ]);

// ─── Global Tool Executor ───────────────────────────────────────

/** Check if a tool name is a global (non-page) tool. */
export const isGlobalTool = (toolName: string): boolean =>
  toolName === 'list_available_pages' || toolName === 'navigate_to_page';

/**
 * Execute a global tool call (not bound to current page).
 * Routes to the appropriate handler based on tool name.
 */
export const executeGlobalTool = async (
  toolName: string,
  args: Record<string, unknown>,
  deps: GlobalToolDeps,
  t: TFn,
): Promise<ToolCallResult> => {
  if (toolName === 'list_available_pages') {
    const pages = flattenMenuTree(deps.menuTree);
    return { success: true, data: pages };
  }

  if (toolName === 'navigate_to_page') {
    const path = args.path as string;
    if (!path || typeof path !== 'string') {
      return {
        success: false,
        error: t('Agent.pathRequired', 'path 参数必填'),
      };
    }
    deps.navigate(path);
    return {
      success: true,
      data: {
        message: t('Agent.navigated', `已导航到 ${path}`),
        currentRoute: path,
      },
    };
  }

  return { success: false, error: `Unknown global tool: ${toolName}` };
};
