import { Icon } from '@iconify/react';
import yaml from 'js-yaml';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ProTableColumnDef, ProTableRef } from '@/components/pro-table';
import { buildColumns, ProTable } from '@/components/pro-table';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useT } from '@/i18n';
import { useUserMenuCodes } from '@/lib/menu-utils';
import { toast } from '@/utils/toast';
import { useI18nAgent } from './agent';
import { LocaleDialog } from './LocaleDialog';
import type { ExportQuery, ImportEntry, LocaleAdmin } from './options';
import {
  createLocaleTableColumns,
  deleteCurrentTenantOverrideCell,
  deleteLocale,
  exportCurrentTenantOverrides,
  exportGlobalTranslations,
  importCurrentTenantOverrides,
  importGlobalTranslations,
  listCurrentTenantKeys,
  listCurrentTenantNamespaces,
  listGlobalKeys,
  listGlobalNamespaces,
  listLocales,
} from './options';
import TranslationKeyTable from './TranslationKeyTable';

type TabValue = 'locales' | 'translations' | 'myOverrides';

/** Parse file text into ImportEntry[]. Auto-detects JSON vs YAML. */
function parseEntries(text: string): ImportEntry[] {
  const trimmed = text.trim();
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    return JSON.parse(trimmed);
  }
  const loaded = yaml.load(trimmed);
  if (Array.isArray(loaded)) return loaded as ImportEntry[];
  throw new Error('Unsupported format');
}

function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Export button group: [JSON] [YAML] */
function ExportButtonGroup({
  exportFn,
  baseName,
}: {
  exportFn: (query?: ExportQuery) => Promise<{ entries: ImportEntry[] }>;
  baseName: string;
}) {
  const t = useT();

  const doExport = (format: 'json' | 'yaml') => {
    void exportFn().then((resp) => {
      if (format === 'yaml') {
        downloadFile(
          yaml.dump(resp.entries, { lineWidth: 120 }),
          `${baseName}.yaml`,
          'text/yaml',
        );
      } else {
        downloadFile(
          JSON.stringify(resp.entries, null, 2),
          `${baseName}.json`,
          'application/json',
        );
      }
      toast.success(t('I18nMgmt.toast.exported', '导出成功'));
    });
  };

  return (
    <div className="inline-flex h-8 divide-x divide-border rounded-md border">
      <Button
        variant="ghost"
        size="sm"
        className="rounded-none rounded-l-md border-0 px-3 text-xs shadow-none"
        onClick={() => doExport('json')}
      >
        <Icon icon="mdi:download" className="mr-1 size-3.5" />
        JSON
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="rounded-none rounded-r-md border-0 px-3 text-xs shadow-none"
        onClick={() => doExport('yaml')}
      >
        <Icon icon="mdi:download" className="mr-1 size-3.5" />
        YAML
      </Button>
    </div>
  );
}

/** Import button + hidden file input. Auto-detects JSON/YAML. */
function ImportButton({
  importFn,
}: {
  importFn: (entries: ImportEntry[]) => Promise<unknown>;
}) {
  const t = useT();
  const ref = useRef<HTMLInputElement>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result as string;
      let entries: ImportEntry[];
      try {
        entries = parseEntries(text);
      } catch {
        toast.assertNotApiError.error(
          t('I18nMgmt.toast.invalidFormat', '文件格式错误'),
        );
        return;
      }
      if (!Array.isArray(entries) || entries.length === 0) {
        toast.assertNotApiError.error(
          t('I18nMgmt.toast.emptyEntries', '导入内容为空或格式不正确'),
        );
        return;
      }
      void importFn(entries).then(() => {
        toast.success(t('I18nMgmt.toast.imported', '导入成功'));
      });
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => ref.current?.click()}>
        <Icon icon="mdi:upload" className="mr-1 size-4" />
        {t('I18nMgmt.btn.import', '导入')}
      </Button>
      <input
        ref={ref}
        type="file"
        accept=".json,.yaml,.yml"
        className="hidden"
        onChange={handleChange}
      />
    </>
  );
}

const I18nPage = () => {
  const t = useT();

  const [activeTab, setActiveTab] = useState<TabValue>('locales');

  // ── Permission-based tab visibility ────────────────────────────
  const menuCodes = useUserMenuCodes();

  const TABS = useMemo(
    () =>
      [
        {
          value: 'locales' as const,
          label: t('I18nMgmt.tab.locales', '语言管理'),
          code: 'i18n:locales',
        },
        {
          value: 'translations' as const,
          label: t('I18nMgmt.tab.translations', '翻译矩阵'),
          code: 'i18n:translations',
        },
        {
          value: 'myOverrides' as const,
          label: t('I18nMgmt.tab.myOverrides', '租户翻译'),
          code: 'i18n:myOverrides',
        },
      ].filter((tab) => menuCodes.has(tab.code)),
    [t, menuCodes],
  );

  // Reset to the first visible tab when permissions change
  useEffect(() => {
    if (TABS.length > 0 && !TABS.some((tab) => tab.value === activeTab)) {
      setActiveTab(TABS[0].value);
    }
  }, [TABS, activeTab]);

  // ── Locales state ──────────────────────────────────────────────
  const [editLocale, setEditLocale] = useState<LocaleAdmin | null>(null);
  const [localeDialogOpen, setLocaleDialogOpen] = useState(false);
  const localeTableRef = useRef<ProTableRef>(null);

  // ── Locale list for translation columns ────────────────────────
  // ProTable's request is the sole data fetcher; it also populates
  // localesData via setLocalesData so the translation tabs can reuse it.
  const [localesData, setLocalesData] = useState<LocaleAdmin[]>([]);

  useI18nAgent(localesData);

  const handleLocaleSuccess = useCallback(() => {
    localeTableRef.current?.refresh();
  }, []);

  // ── Locales tab columns ────────────────────────────────────────
  const localeColumns = useMemo(
    () =>
      buildColumns<LocaleAdmin>(createLocaleTableColumns(t), {
        isEnabled: ({ row }) => (
          <Switch checked={row.original.isEnabled} disabled />
        ),
        actions: ({ row }) => {
          const locale = row.original;
          return (
            <div className="inline-flex items-center gap-1">
              <Button
                variant="ghost"
                size="xs"
                onClick={() => {
                  setEditLocale(locale);
                  setLocaleDialogOpen(true);
                }}
              >
                {t('Common.edit', '编辑')}
              </Button>
              <Button
                variant="ghost"
                size="xs"
                className="text-destructive hover:text-destructive"
                onClick={() => {
                  void deleteLocale(locale.locale).then(() => {
                    toast.success(t('I18nMgmt.toast.deleted', '删除成功'));
                    handleLocaleSuccess();
                  });
                }}
              >
                {t('Common.delete', '删除')}
              </Button>
            </div>
          );
        },
      }) as ProTableColumnDef<LocaleAdmin>[],
    [t, handleLocaleSuccess],
  );

  // ── Toolbar extras ─────────────────────────────────────────────
  const globalToolbar = useMemo(
    () => (
      <>
        <ImportButton
          importFn={(entries) =>
            importGlobalTranslations({
              scope: 'global',
              strategy: 'replace',
              entries,
            })
          }
        />
        <ExportButtonGroup
          exportFn={exportGlobalTranslations}
          baseName="global-translations"
        />
      </>
    ),
    [],
  );

  const tenantToolbar = useMemo(
    () => (
      <>
        <ImportButton
          importFn={(entries) =>
            importCurrentTenantOverrides({
              scope: 'tenant',
              strategy: 'replace',
              entries,
            })
          }
        />
        <ExportButtonGroup
          exportFn={exportCurrentTenantOverrides}
          baseName="tenant-overrides"
        />
      </>
    ),
    [],
  );

  return (
    <div className="flex h-full flex-col gap-4">
      <Tabs
        className="min-h-0 flex-1"
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as TabValue)}
      >
        <TabsList variant="line">
          {TABS.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {TABS.some((t) => t.value === 'locales') && (
          <TabsContent value="locales">
            <ProTable
              ref={localeTableRef}
              columns={localeColumns}
              request={async () => {
                const data = await listLocales();
                setLocalesData(data);
                return data;
              }}
              search={false}
              refreshable
              header={{
                title: t('I18nMgmt.tab.locales', '语言管理'),
                toolbar: (
                  <Button
                    onClick={() => {
                      setEditLocale(null);
                      setLocaleDialogOpen(true);
                    }}
                  >
                    {t('I18nMgmt.action.addLocale', '新建语言')}
                  </Button>
                ),
              }}
              pagination={false}
            />
          </TabsContent>
        )}

        {TABS.some((t) => t.value === 'translations') && (
          <TabsContent value="translations" className="overflow-hidden">
            <TranslationKeyTable
              locales={localesData ?? []}
              loadKeys={listGlobalKeys}
              loadNamespaces={listGlobalNamespaces}
              onCommit={(entries) =>
                importGlobalTranslations({
                  scope: 'global',
                  strategy: 'replace',
                  entries,
                })
              }
              showEntryMeta
              toolbarExtra={globalToolbar}
              title={t('I18nMgmt.tab.translations', '翻译矩阵')}
            />
          </TabsContent>
        )}

        {TABS.some((t) => t.value === 'myOverrides') && (
          <TabsContent value="myOverrides" className="overflow-hidden">
            <TranslationKeyTable
              locales={localesData ?? []}
              loadKeys={listCurrentTenantKeys}
              loadNamespaces={listCurrentTenantNamespaces}
              onCommit={(entries) =>
                importCurrentTenantOverrides({
                  scope: 'tenant',
                  strategy: 'replace',
                  entries,
                })
              }
              onResetCell={(params) =>
                deleteCurrentTenantOverrideCell(params).then(() => undefined)
              }
              toolbarExtra={tenantToolbar}
              title={t('I18nMgmt.tab.myOverrides', '租户翻译')}
            />
          </TabsContent>
        )}
      </Tabs>

      <LocaleDialog
        open={localeDialogOpen}
        locale={editLocale}
        onOpenChange={(open) => {
          setLocaleDialogOpen(open);
          if (!open) {
            setEditLocale(null);
          }
        }}
        onSuccess={handleLocaleSuccess}
      />
    </div>
  );
};

export default I18nPage;
