# ProTable 使用文档

基于 `@tanstack/react-table` 的声明式数据表格方案。配置驱动——在 `options.ts` 定义列，`buildColumns()` 生成 TanStack 列定义，ProTable 自动处理分页、搜索、数据请求。

---

## 快速开始

### 1. 在 `options.ts` 中定义列

```ts
// src/pages/system/my-module/options.ts
import type { ColumnOption } from '@/components/pro-table';
import type { TFn } from '@/i18n';

export function createUserTableColumns(t: TFn): ColumnOption[] {
  return [
    {
      key: 'username',
      label: t('UserMgmt.username', '用户名'),
      size: 140,
      filterable: true,
      search: {
        type: 'text',
        placeholder: t('UserMgmt.usernamePlaceholder', '搜索用户名'),
      },
      description: t('UserMgmt.usernameDesc', '用户登录名'),
    },
    {
      key: 'email',
      label: t('UserMgmt.email', '邮箱'),
      size: 180,
      filterable: false,
      description: t('UserMgmt.emailDesc', '用户邮箱地址'),
    },
    {
      key: 'status',
      label: t('UserMgmt.status', '状态'),
      size: 80,
      align: 'center',
      filterable: false,
      description: t('UserMgmt.statusDesc', '启用/禁用状态'),
    },
    {
      key: 'actions',
      label: t('UserMgmt.actions', '操作'),
      size: 160,
      enableResizing: false,
      align: 'center',
      filterable: false,
      description: t('UserMgmt.actionsDesc', '可执行的操作'),
    },
  ];
}
```

### 2. 在页面中使用

```tsx
// src/pages/system/my-module/index.tsx
import { useCallback, useMemo, useRef, useState } from 'react';
import { listUsers } from '@/api/users';
import { buildColumns, ProTable } from '@/components/pro-table';
import type { ProTableColumnDef, ProTableRef } from '@/components/pro-table';
import { Button } from '@/components/ui/button';
import { useT } from '@/i18n';
import type { UserResponse } from '@/types/user';
import { createUserTableColumns } from './options';
import { UserDialog } from './UserDialog';

const UsersPage = () => {
  const t = useT();
  const [editUser, setEditUser] = useState<UserResponse | null>(null);
  const tableRef = useRef<ProTableRef>(null);

  const userColumns = useMemo(() => createUserTableColumns(t), [t]);

  const handleSuccess = useCallback(() => {
    tableRef.current?.refresh();
  }, []);

  const columns = useMemo(
    () =>
      buildColumns<UserResponse>(userColumns, {
        status: ({ row }) => {
          const isActive = row.original.status === 'active';
          return isActive ? '启用' : '禁用';
        },
        actions: ({ row }) => (
          <div className="inline-flex items-center gap-1">
            <Button variant="ghost" size="xs" onClick={() => setEditUser(row.original)}>
              {t('UserMgmt.btn.edit', '编辑')}
            </Button>
          </div>
        ),
      }) as ProTableColumnDef<UserResponse>[],
    [userColumns, t],
  );

  return (
    <>
      <ProTable
        ref={tableRef}
        columns={columns}
        request={(params) => listUsers(params)}
        header={{
          title: t('UserMgmt.title', '用户管理'),
          toolbar: (
            <Button onClick={() => setEditUser({} as UserResponse)}>
              {t('UserMgmt.action.create', '新建用户')}
            </Button>
          ),
        }}
      />

      <UserDialog
        open={!!editUser}
        user={editUser}
        onOpenChange={(open) => { if (!open) setEditUser(null); }}
        onSuccess={handleSuccess}
      />
    </>
  );
};

export default UsersPage;
```

---

## ProTable Props

| Prop | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `columns` | `ProTableColumnDef<TData>[]` | — | 列定义（由 `buildColumns` 生成） |
| `request` | `(params) => Promise<PaginatedResponse<TData> \| TData[]>` | — | 数据请求函数 |
| `header` | `{ title?: ReactNode; toolbar?: ReactNode }?` | — | 标题和工具栏 |
| `search` | `false \| { defaultCollapsed?, searchText?, resetText? }` | `undefined` | 搜索表单配置。`false` 隐藏 |
| `pagination` | `false \| { defaultPageSize?, pageSizeOptions? }` | `undefined` | 分页配置。`false` 隐藏 |
| `initialColumnPinning` | `ColumnPinningState?` | — | 列固定（左右固定） |
| `params` | `Record<string, unknown>?` | — | 额外请求参数（每次请求合并） |
| `getSubRows` | `(row: TData) => TData[] \| undefined?` | — | 树形数据的子行获取 |

### ProTableRef

`ProTable` 支持通过 ref 暴露刷新方法，适合在弹窗保存成功、批量操作完成后刷新当前表格数据，不需要通过修改 `key` 重建整个表格。

```tsx
import { useRef } from 'react';
import { ProTable } from '@/components/pro-table';
import type { ProTableRef } from '@/components/pro-table';

const tableRef = useRef<ProTableRef>(null);

<ProTable ref={tableRef} columns={columns} request={listUsers} />;

tableRef.current?.refresh();
```

### request 签名

```ts
request: (params: {
  page: number;
  pageSize: number;
  [key: string]: unknown;  // 搜索参数 + extra params
}) => Promise<PaginatedResponse<TData> | TData[]>;
```

返回值支持两种格式：
- `PaginatedResponse<TData>` — 标准 `{ items, totalItems, totalPages, page, pageSize }`
- `TData[]` — 纯数组（无分页）

---

## ColumnOption（列配置）

### 基础属性

| 属性 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `key` | `string` | — | 列标识，对应数据的字段名（映射为 `accessorKey`） |
| `label` | `string` | — | 列标题 |
| `description` | `string?` | — | 列描述（agent 元数据） |
| `size` | `number?` | — | 列宽（px） |
| `minSize` | `number?` | — | 最小列宽 |
| `maxSize` | `number?` | — | 最大列宽 |
| `enableResizing` | `boolean?` | `true` | 是否允许拖拽调整列宽 |
| `align` | `'left' \| 'center' \| 'right'?` | `'left'` | 单元格对齐方式 |
| `ellipsis` | `boolean?` | `true` | 超长文本省略号 |
| `showOverflowTooltip` | `boolean?` | `true` | 省略时显示 tooltip |
| `filterable` | `boolean?` | — | 是否可筛选（agent 元数据，由 `search` 决定） |
| `sortable` | `boolean?` | — | 是否可排序（agent 元数据） |

### 搜索配置（search）

列配置中添加 `search` 即让该列出现在搜索表单中：

| 属性 | 类型 | 说明 |
|------|------|------|
| `search.type` | `'text' \| 'select' \| 'date' \| 'dateRange' \| ...` | 搜索输入类型 |
| `search.placeholder` | `string?` | 搜索框占位文字 |
| `search.options` | `SelectOption[]?` | select 类型的选项 |
| `search.remote` | `RemoteOptionSource?` | remote-select 的远程数据源 |
| `search.order` | `number?` | 搜索字段排序（越小越靠前） |
| `search.initialValue` | `unknown?` | 搜索框初始值 |
| `search.transform` | `(value: unknown) => Record<string, unknown>?` | 搜索值转换（如 dateRange → startDate + endDate） |

---

## buildColumns

将 `ColumnOption[]` 转换为 TanStack `ColumnDef[]`：

```ts
function buildColumns<TData>(
  options: ColumnOption[],
  renderers?: Record<string, CellRenderer<TData>>,
): ColumnDef<TData>[]
```

### CellRenderer

```ts
type CellRenderer<TData> = (context: CellContext<TData, unknown>) => ReactNode;
```

大多数场景只用到 `{ row }`：

```ts
buildColumns<UserResponse>(columns, {
  status: ({ row }) => {
    const isActive = row.original.status === 'active';
    return <Badge variant={isActive ? 'default' : 'secondary'}>{isActive ? '启用' : '禁用'}</Badge>;
  },
  createdAt: ({ row }) => {
    const val = row.original.createdAt;
    return val ? new Date(val).toLocaleString() : '-';
  },
  actions: ({ row }) => (
    <Button variant="ghost" size="xs" onClick={() => handleEdit(row.original)}>
      编辑
    </Button>
  ),
})
```

---

## 常见模式

### 带搜索的表格

```ts
// options.ts
export function createUserTableColumns(t: TFn): ColumnOption[] {
  return [
    {
      key: 'username',
      label: t('UserMgmt.username', '用户名'),
      size: 140,
      filterable: true,
      search: { type: 'text', placeholder: '搜索用户名' },
    },
    {
      key: 'status',
      label: t('UserMgmt.status', '状态'),
      size: 100,
      filterable: true,
      search: {
        type: 'select',
        options: [
          { value: 'active', label: '启用' },
          { value: 'disabled', label: '禁用' },
        ],
      },
    },
    // 没有 search 的列不会出现在搜索表单中
    { key: 'email', label: '邮箱', size: 180 },
  ];
}
```

```tsx
// 搜索表单默认收起（超过4个字段时显示展开/收起按钮）
<ProTable
  columns={columns}
  request={listUsers}
  search={{ defaultCollapsed: false }}  // 默认展开
/>
```

### 树形数据

```tsx
<ProTable
  columns={columns}
  request={listMenus}
  getSubRows={(row) => row.children}
/>
```

### 列固定

```tsx
<ProTable
  columns={columns}
  request={listUsers}
  initialColumnPinning={{
    left: ['name'],     // 左侧固定
    right: ['actions'], // 右侧固定
  }}
/>
```

### 隐藏搜索/分页

```tsx
// 不需要搜索表单
<ProTable columns={columns} request={listItems} search={false} />

// 不需要分页（一次性加载全部数据）
<ProTable columns={columns} request={fetchAllItems} pagination={false} />
```

### 搜索值转换（dateRange）

```ts
{
  key: 'createdAt',
  label: '创建时间',
  search: {
    type: 'dateRange',
    transform: (value) => {
      const [start, end] = value as [string, string];
      return { startDate: start, endDate: end };
    },
  },
}
```

`transform` 将单个搜索值转换为多个请求参数。不设置 `transform` 时，搜索值直接以 `key` 为参数名传给 `request`。

### 传递额外参数

```tsx
<ProTable
  columns={columns}
  request={(params) => listFileReferences(params, refsSys)}
  params={{ resourceType: 'system' }}  // 每次请求都会带上
/>
```

---

## 数据流

```
用户操作 → ProTable 内部合并参数 → request(params) → 后端响应 → 渲染

params 合并顺序:
{ page, pageSize, ...searchParams, ...extraParams }
```

搜索触发时会自动将 `page` 重置为 1。

---

## 文件结构

```
src/components/pro-table/
├── types.ts          # ColumnOption, ProTableProps, ProTableColumnDef 等类型
├── index.tsx         # ProTable 组件（分页 + 搜索 + DataTable 组装）
├── build-columns.tsx # buildColumns() — ColumnOption[] → ColumnDef[]
└── search-form.tsx   # 搜索表单（自动从 columns 的 meta.search 提取字段）
```

---

## options.ts 约定

每个页面的 `options.ts` 是**唯一配置来源**，包含：

- 表格列定义：`createXxxTableColumns(t: TFn): ColumnOption[]`
- 表单字段定义：`createXxxFormFields(t: TFn): FieldConfig[]`
- 页面操作参数：`createXxxParams(t: TFn): PageActionParam[]`
- 全局常量 ID：`export const XXX_TABLE_ID = '...'`（需加 `biome-ignore` 注释）

组件文件只做**渲染逻辑**，不内联配置数据。
