import type { ReactNode } from 'react';
import type { z } from 'zod';

export type FieldType =
  | 'text'
  | 'password'
  | 'textarea'
  | 'number'
  | 'boolean'
  | 'date'
  | 'datetime'
  | 'dateRange'
  | 'select'
  | 'remote-select'
  | 'multiselect'
  | 'tags'
  | 'icon'
  | 'tree-select'
  | 'custom';

export interface SelectOption {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
}

export interface RemoteOptionSource {
  resolver: (keyword: string) => Promise<SelectOption[]>;
}

export interface CustomRenderProps {
  field: unknown;
  config: FieldConfig;
}

export interface FieldConfig {
  name: string;
  label: string;
  type: FieldType;
  placeholder?: string;
  description?: string;
  rule?: z.ZodTypeAny;
  required?: boolean;
  defaultValue?: unknown;
  options?: SelectOption[];
  remote?: RemoteOptionSource;
  /** Tree data for tree-select field type */
  treeItems?: unknown[];
  showWhen?: { field: string; value: unknown };
  disabledWhen?: { field: string; value: unknown };
  colSpan?: 1 | 2 | 3 | 4;
  render?: (props: CustomRenderProps) => ReactNode;
}
