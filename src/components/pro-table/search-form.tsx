import { Icon } from '@iconify/react';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Input } from '@/components/ui/input';
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
import { SmartDateInput } from '@/components/ui/smart-date-input';
import { useT } from '@/i18n';
import { cn } from '@/lib/utils';
import type { ColumnFilterConfig, ProTableColumnDef } from './types';

// biome-ignore lint/style/useNamingConvention: TData/TValue are TanStack Table conventions
interface SearchFormProps<TData, TValue> {
  columns: ProTableColumnDef<TData, TValue>[];
  defaultCollapsed?: boolean;
  searchText?: string;
  resetText?: string;
  onSearch: (values: Record<string, unknown>) => void;
  onReset: () => void;
  onValuesChange?: (values: Record<string, unknown>) => void;
}

// biome-ignore lint/style/useNamingConvention: TData/TValue are TanStack Table conventions
const extractSearchFields = <TData, TValue>(
  columns: ProTableColumnDef<TData, TValue>[],
): Array<{
  key: string;
  config: ColumnFilterConfig;
}> => {
  const fields: Array<{
    key: string;
    config: ColumnFilterConfig;
    order: number;
  }> = [];

  columns.forEach((col) => {
    const searchConfig = col.meta?.search;
    if (!searchConfig) {
      return;
    }
    const key = ((col as unknown as Record<string, unknown>).id ??
      (col as unknown as Record<string, unknown>).accessorKey) as
      | string
      | undefined;
    if (!key) {
      return;
    }
    fields.push({
      key,
      config: searchConfig,
      order: searchConfig.order ?? 0,
    });
  });

  fields.sort((a, b) => a.order - b.order);

  return fields.map(({ key, config }) => ({ key, config }));
};

// biome-ignore lint/style/useNamingConvention: TData/TValue are TanStack Table conventions
const SearchForm = <TData, TValue>({
  columns,
  defaultCollapsed = true,
  searchText,
  resetText,
  onSearch,
  onReset,
  onValuesChange,
}: SearchFormProps<TData, TValue>) => {
  const t = useT();
  const searchLabel = searchText ?? t('Common.query', '查询');
  const resetLabel = resetText ?? t('Common.reset', '重置');
  const searchFields = useMemo(() => extractSearchFields(columns), [columns]);

  // Pre-compute key → header label map (avoids O(n*m) columns.find in every render)
  const headerMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const col of columns) {
      const def = col as unknown as Record<string, unknown>;
      const key = (def.id ?? def.accessorKey) as string | undefined;
      if (key && typeof col.header === 'string') {
        map.set(key, col.header);
      }
    }
    return map;
  }, [columns]);

  const initialValues = useMemo(() => {
    const values: Record<string, unknown> = {};
    searchFields.forEach(({ key, config }) => {
      if (config.initialValue !== undefined) {
        values[key] = config.initialValue;
      }
    });
    return values;
  }, [searchFields]);

  const [values, setValues] = useState<Record<string, unknown>>(initialValues);
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  /** Fields per row (4 columns layout). */
  const fieldsPerRow = 4;
  const showCollapseToggle = searchFields.length > fieldsPerRow;

  const handleChange = (key: string, value: unknown) => {
    setValues((prev) => {
      const next = { ...prev, [key]: value };
      onValuesChange?.(next);
      return next;
    });
  };

  const handleSubmit = () => {
    const transformed: Record<string, unknown> = {};
    searchFields.forEach(({ key, config }) => {
      const raw = values[key];
      if (raw === undefined || raw === '' || raw === null) {
        return;
      }
      if (config.transform) {
        Object.assign(transformed, config.transform(raw));
      } else {
        transformed[key] = raw;
      }
    });
    onSearch(transformed);
  };

  const handleReset = () => {
    setValues(initialValues);
    onValuesChange?.(initialValues);
    onReset();
  };

  if (searchFields.length === 0) {
    return null;
  }

  return (
    <form
      className="flex flex-wrap items-end gap-3 rounded-md border bg-card p-4 [contain:layout_style]"
      onSubmit={(e) => {
        e.preventDefault();
        handleSubmit();
      }}
    >
      {searchFields.map(({ key, config }, index) => (
        <div
          key={key}
          className={cn(
            'flex min-w-[180px] flex-col gap-1.5',
            collapsed && index >= fieldsPerRow && 'hidden',
          )}
        >
          <label
            htmlFor={`search-${key}`}
            className="text-sm font-medium text-muted-foreground"
          >
            {headerMap.get(key) ?? key}
          </label>
          <SearchField
            id={`search-${key}`}
            config={config}
            value={values[key]}
            onChange={(v) => handleChange(key, v)}
            onClear={() => handleChange(key, undefined)}
          />
        </div>
      ))}
      <div className="flex items-center gap-2 pb-0.5">
        <Button type="submit" size="sm">
          {searchLabel}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={handleReset}>
          {resetLabel}
        </Button>
        {showCollapseToggle && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setCollapsed((prev) => !prev)}
          >
            {collapsed
              ? t('Common.expand', '展开')
              : t('Common.collapse', '收起')}
          </Button>
        )}
      </div>
    </form>
  );
};

const SearchField = ({
  id,
  config,
  value,
  onChange,
  onClear,
}: {
  id: string;
  config: ColumnFilterConfig;
  value: unknown;
  onChange: (value: unknown) => void;
  onClear: () => void;
}) => {
  const t = useT();
  const type = config.type ?? 'text';

  const getMultiSelectTriggerText = (selectedLabels: string[]) => {
    if (selectedLabels.length === 0) {
      return config.placeholder ?? t('Common.select', '请选择');
    }
    if (selectedLabels.length === 1) {
      return selectedLabels[0];
    }
    return t('Common.selectedCount', '已选 {{count}} 项', {
      count: selectedLabels.length,
    });
  };

  if (type === 'select') {
    return (
      <Select
        value={(value as string) ?? ''}
        onValueChange={(v: string) => onChange(v || undefined)}
      >
        <SelectTrigger
          id={id}
          className="h-8 w-[180px]"
          onClear={value != null && value !== '' ? onClear : undefined}
        >
          <SelectValue
            placeholder={config.placeholder ?? t('Common.select', '请选择')}
          />
        </SelectTrigger>
        <SelectContent>
          {config.options?.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  if (type === 'multiselect') {
    const selected = Array.isArray(value) ? (value as string[]) : [];
    const toggle = (item: string) => {
      onChange(
        selected.includes(item)
          ? selected.filter((selectedItem) => selectedItem !== item)
          : [...selected, item],
      );
    };
    const selectedLabels = selected
      .map((item) => config.options?.find((opt) => opt.value === item)?.label)
      .filter((label): label is string => Boolean(label));
    const triggerText = getMultiSelectTriggerText(selectedLabels);

    return (
      <Popover>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            className="h-8 w-[220px] justify-between px-3 font-normal"
          >
            <span className="truncate text-left">{triggerText}</span>
            <Icon
              icon="lucide:chevrons-up-down"
              className="ml-2 size-3.5 shrink-0 opacity-50"
            />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[360px] max-w-[90vw] p-0">
          <Command>
            <CommandInput
              placeholder={config.placeholder ?? t('Common.search', '搜索...')}
            />
            <CommandList className="max-h-72">
              <CommandEmpty>{t('Common.noMatch', '无匹配项')}</CommandEmpty>
              <CommandGroup>
                {config.options?.map((opt) => {
                  const checked = selected.includes(opt.value);
                  return (
                    <CommandItem
                      key={opt.value}
                      value={`${opt.label} ${opt.description ?? ''}`}
                      disabled={opt.disabled}
                      onSelect={() => toggle(opt.value)}
                      className="items-start"
                    >
                      <Icon
                        icon={checked ? 'lucide:check-square' : 'lucide:square'}
                        className={cn(
                          'mt-0.5 size-4',
                          checked ? 'opacity-100' : 'opacity-40',
                        )}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{opt.label}</span>
                        {opt.description && (
                          <span className="block truncate text-xs text-muted-foreground">
                            {opt.description}
                          </span>
                        )}
                      </span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    );
  }

  if (type === 'date') {
    return (
      <Input
        id={id}
        type="date"
        className="h-8 w-[180px]"
        placeholder={config.placeholder}
        value={(value as string) ?? ''}
        onChange={(e) => onChange(e.target.value || undefined)}
      />
    );
  }

  if (type === 'dateRange') {
    const range = value as [string, string] | undefined;
    const showTime = config.showTime ?? true;
    const showSeconds = config.showSeconds ?? false;
    return (
      <div className="flex items-center gap-1">
        <SmartDateInput
          value={range?.[0]}
          onChange={(v) =>
            onChange([v ?? '', range?.[1] ?? ''] as unknown as [string, string])
          }
          placeholder={t('Common.dateStart', '开始日期')}
          showTime={showTime}
          showSeconds={showSeconds}
          showHints={false}
        />
        <span className="text-muted-foreground shrink-0 text-xs">~</span>
        <SmartDateInput
          value={range?.[1]}
          onChange={(v) =>
            onChange([range?.[0] ?? '', v ?? ''] as unknown as [string, string])
          }
          placeholder={t('Common.dateEnd', '结束日期')}
          showTime={showTime}
          showSeconds={showSeconds}
          showHints={false}
        />
      </div>
    );
  }

  return (
    <Input
      id={id}
      className="h-8 w-[180px]"
      placeholder={config.placeholder ?? t('Common.input', '请输入')}
      value={(value as string) ?? ''}
      onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
        onChange(e.target.value || undefined)
      }
    />
  );
};

export { SearchForm };
