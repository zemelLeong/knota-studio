import { Icon } from '@iconify/react';
import type { ManipulateType } from 'dayjs';
import dayjs from 'dayjs';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { cn } from '@/lib/utils';
import { formatParsed, smartParse } from '@/utils/smart-date-parse';

// ─── Local-timezone serialization ─────────────────────

const serializeFormat = 'YYYY-MM-DDTHH:mm:ss';

function serializeLocal(d: dayjs.Dayjs): string {
  return d.format(serializeFormat);
}

// ─── Cursor-aware segment detection ───────────────────

interface DateSegment {
  start: number;
  end: number;
  unit: ManipulateType;
}

function getSegments(showTime: boolean, showSeconds: boolean): DateSegment[] {
  // "YYYY-MM-DD HH:mm:ss"
  //  0123456789012345678
  const segs: DateSegment[] = [
    { start: 0, end: 4, unit: 'year' },
    { start: 5, end: 7, unit: 'month' },
    { start: 8, end: 10, unit: 'day' },
  ];
  if (showTime) {
    segs.push({ start: 11, end: 13, unit: 'hour' });
    segs.push({ start: 14, end: 16, unit: 'minute' });
    if (showSeconds) {
      segs.push({ start: 17, end: 19, unit: 'second' });
    }
  }
  return segs;
}

function detectUnitAtCursor(
  cursor: number,
  showTime: boolean,
  showSeconds: boolean,
): ManipulateType | undefined {
  const segs = getSegments(showTime, showSeconds);
  const hit = segs.find((s) => cursor >= s.start && cursor <= s.end);
  return hit?.unit;
}

// ─── Help tips ─────────────────────────────────────────

const helpSections = [
  {
    title: '自然语言',
    items: ['明天', '后天', '下周五三点', '3天后', '明天下午3点'],
  },
  {
    title: '此刻',
    items: ['now', '此刻', '现在'],
  },
  {
    title: '快捷指令',
    items: ['+3d（3天后）', '-1w（1周前）', '+2h（2小时后）', '+1M（1个月后）'],
  },
  {
    title: '紧凑数字',
    items: ['250203 → 2025-02-03', '2502031430 → 2025-02-03 14:30'],
  },
  {
    title: '键盘操作',
    items: ['↑↓ 调整（光标处字段）', 'Enter 确认', 'Esc 取消'],
  },
];

// ─── Portal-positioned floating panel helper ───────────

function FloatingPanel({
  inputRef,
  className,
  children,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  className?: string;
  children: React.ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const panel = panelRef.current;
    const input = inputRef.current;
    if (!panel || !input) return;

    const position = () => {
      const rect = input.getBoundingClientRect();
      panel.style.position = 'fixed';
      panel.style.left = `${rect.left}px`;
      panel.style.top = `${rect.bottom + 4}px`;
      panel.style.width = `${rect.width}px`;
    };

    position();

    // Re-position on scroll/resize
    const observer = new ResizeObserver(position);
    observer.observe(input);
    return () => observer.disconnect();
  }, [inputRef]);

  return createPortal(
    <div
      ref={panelRef}
      className={cn(
        'z-50 rounded-md border bg-popover text-popover-foreground shadow-sm',
        'animate-in fade-in-0 zoom-in-95 data-[side=bottom]:slide-in-from-top-1',
        'duration-150',
        className,
      )}
    >
      {children}
    </div>,
    document.body,
  );
}

// ─── Props ─────────────────────────────────────────────

interface SmartDateInputProps {
  value?: string;
  onChange?: (value: string | undefined) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  showTime?: boolean;
  showSeconds?: boolean;
  showHints?: boolean;
}

// ─── Component ─────────────────────────────────────────

function SmartDateInput({
  value,
  onChange,
  placeholder,
  disabled,
  className,
  showTime = true,
  showSeconds = false,
  showHints = true,
}: SmartDateInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const [focused, setFocused] = useState(false);
  const [rawText, setRawText] = useState('');

  // Committed value derived from props
  const committedDayjs = useMemo(() => {
    if (!value) return undefined;
    const d = dayjs(value);
    return d.isValid() ? d : undefined;
  }, [value]);

  // Initialize rawText when value changes externally
  useEffect(() => {
    if (!focused) {
      setRawText(
        committedDayjs
          ? formatParsed(committedDayjs, showTime, showSeconds)
          : '',
      );
    }
  }, [committedDayjs, focused, showTime, showSeconds]);

  // Parse anchor: use "now" when input is empty or user cleared it,
  // otherwise use committed value as reference point.
  const parseRef = useMemo(() => {
    if (!focused || !rawText.trim()) return dayjs();
    return committedDayjs ?? dayjs();
  }, [focused, rawText, committedDayjs]);

  // Real-time parsed result
  const parsed = useMemo(() => {
    if (!focused || !rawText.trim()) return undefined;
    return smartParse(rawText, parseRef, showTime);
  }, [rawText, focused, parseRef, showTime]);

  // Preview visibility logic
  const showPreview = focused && rawText.trim().length > 0;
  const previewText = useMemo(() => {
    if (!showPreview) return undefined;
    if (parsed) {
      const formatted = formatParsed(parsed, showTime, showSeconds);
      const committedFormatted = committedDayjs
        ? formatParsed(committedDayjs, showTime, showSeconds)
        : '';
      if (formatted === committedFormatted) return undefined;
      return `→ ${formatted}`;
    }
    return '无法识别';
  }, [showPreview, parsed, committedDayjs, showTime, showSeconds]);

  const previewIsError = showPreview && !parsed;

  // Show help whenever focused (user may refer to it while typing)
  const showHelp = focused && showHints;

  // ─── Handlers ──────────────────────────────────────

  const confirmValue = useCallback(
    (d: dayjs.Dayjs) => {
      const result = showSeconds ? d : d.second(0);
      onChange?.(serializeLocal(result));
    },
    [onChange, showSeconds],
  );

  const handleFocus = useCallback(() => {
    setFocused(true);
    setTimeout(() => inputRef.current?.select(), 0);
  }, []);

  const handleBlur = useCallback(() => {
    setFocused(false);
    setRawText(
      committedDayjs ? formatParsed(committedDayjs, showTime, showSeconds) : '',
    );
  }, [committedDayjs, showTime, showSeconds]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newText = e.target.value;
      setRawText(newText);
      if (newText.trim() === '') {
        onChange?.(undefined);
      }
    },
    [onChange],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      const base = parsed ?? committedDayjs;

      if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && base) {
        e.preventDefault();
        const amount = e.key === 'ArrowUp' ? 1 : -1;

        const cursorPos = inputRef.current?.selectionStart ?? 0;
        const cursorUnit = detectUnitAtCursor(cursorPos, showTime, showSeconds);

        let unit: ManipulateType;
        if (cursorUnit) {
          unit = cursorUnit;
        } else if (e.shiftKey) {
          unit = 'hour';
        } else if (e.ctrlKey || e.metaKey) {
          unit = 'month';
        } else {
          unit = 'day';
        }

        const adjusted = base.add(amount, unit);
        const newText = formatParsed(adjusted, showTime, showSeconds);
        setRawText(newText);

        requestAnimationFrame(() => {
          if (inputRef.current) {
            inputRef.current.setSelectionRange(cursorPos, cursorPos);
          }
        });
        return;
      }

      if (e.key === 'Enter') {
        e.preventDefault();
        if (parsed) {
          confirmValue(parsed);
          setRawText(formatParsed(parsed, showTime, showSeconds));
          inputRef.current?.blur();
        }
        return;
      }

      if (e.key === 'Escape') {
        e.preventDefault();
        setRawText(
          committedDayjs
            ? formatParsed(committedDayjs, showTime, showSeconds)
            : '',
        );
        inputRef.current?.blur();
        return;
      }

      if (e.key === 'Tab') {
        if (parsed) {
          confirmValue(parsed);
          setRawText(formatParsed(parsed, showTime, showSeconds));
        }
      }
    },
    [parsed, committedDayjs, showTime, showSeconds, confirmValue],
  );

  const handleClear = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      onChange?.(undefined);
      setRawText('');
      inputRef.current?.focus();
    },
    [onChange],
  );

  // ─── Computed display value ───────────────────────

  const displayValue = focused
    ? rawText
    : (committedDayjs && formatParsed(committedDayjs, showTime, showSeconds)) ||
      '';

  const showClear = !disabled && !!committedDayjs;

  // ─── Render ────────────────────────────────────────

  return (
    <div className={cn('relative', className)}>
      <div className="flex items-center">
        <input
          ref={inputRef}
          type="text"
          value={displayValue}
          onChange={handleChange}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          placeholder={placeholder ?? '输入日期，如：明天、+3d、2025-06-01'}
          disabled={disabled}
          aria-invalid={previewIsError ? true : undefined}
          data-slot="input"
          className={cn(
            'h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 pr-8 text-base shadow-xs transition-[color,box-shadow] outline-none selection:bg-primary selection:text-primary-foreground placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30',
            'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
            'aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40',
          )}
        />
        {showClear && (
          <button
            type="button"
            className="absolute right-2 flex size-5 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground"
            onClick={handleClear}
            tabIndex={-1}
            aria-label="Clear"
          >
            <Icon icon="lucide:x" className="size-3.5" />
          </button>
        )}
      </div>

      {/* Floating panel: preview + optional hints */}
      {(showPreview && previewText) || showHelp ? (
        <FloatingPanel inputRef={inputRef} className="text-xs">
          {/* Preview line */}
          {showPreview && previewText && (
            <div className="px-3 py-1.5">
              <span
                className={cn(
                  previewIsError
                    ? 'text-destructive/70'
                    : 'text-muted-foreground',
                )}
                role="status"
                aria-live="polite"
              >
                {previewText}
              </span>
            </div>
          )}
          {/* Hints section */}
          {showHelp && (
            <div
              className={cn(
                'px-3 py-2 space-y-1.5',
                showPreview && previewText && 'border-t',
              )}
            >
              {helpSections.map((section) => (
                <div key={section.title}>
                  <span className="font-medium text-foreground/80">
                    {section.title}
                  </span>
                  <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-muted-foreground">
                    {section.items.map((item) => (
                      <span key={item}>{item}</span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </FloatingPanel>
      ) : null}
    </div>
  );
}

export type { SmartDateInputProps };
export { SmartDateInput };
