import { Icon } from '@iconify/react';
import dayjs from 'dayjs';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Input } from '@/components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';

// ─── Constants ─────────────────────────────────────────

const FORMAT_FULL = 'YYYY-MM-DD HH:mm:ss';
const FORMAT_MINUTE = 'YYYY-MM-DD HH:mm';
const FORMAT_DATE = 'YYYY-MM-DD';
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = Array.from({ length: 60 }, (_, i) => i);
const SECONDS = Array.from({ length: 60 }, (_, i) => i);
const SCROLL_DELAY = 300;

// ─── Hook: useScrollTo (rc-picker pattern) ─────────────
// Each frame moves 1/3 of remaining distance → natural deceleration

const SPEED_PTG = 1 / 3;

function useScrollTo(
  ulRef: React.RefObject<HTMLUListElement | null>,
  value: number | string,
) {
  const scrollingRef = useRef(false);
  const scrollRafRef = useRef(0);
  const scrollDistRef = useRef<number | null>(null);
  const scrollRafTimesRef = useRef(0);

  const isScrolling = useCallback(() => scrollingRef.current, []);

  const stopScroll = useCallback(() => {
    if (scrollRafRef.current) cancelAnimationFrame(scrollRafRef.current);
    scrollingRef.current = false;
  }, []);

  const startScroll = useCallback(() => {
    const ul = ulRef.current;
    scrollDistRef.current = null;
    scrollRafTimesRef.current = 0;

    if (!ul) return;

    const targetLi = ul.querySelector<HTMLLIElement>(`[data-value="${value}"]`);
    const firstLi = ul.querySelector<HTMLLIElement>('li');
    if (!targetLi || !firstLi) return;

    const doScroll = () => {
      stopScroll();
      scrollingRef.current = true;
      scrollRafTimesRef.current += 1;

      const { scrollTop: currentTop } = ul;
      const targetTop = targetLi.offsetTop - firstLi.offsetTop;

      // Wait for element to render (5 frames is enough)
      if (
        (targetLi.offsetTop === 0 && targetLi !== firstLi) ||
        !ul.offsetParent
      ) {
        if (scrollRafTimesRef.current <= 5) {
          scrollRafRef.current = requestAnimationFrame(doScroll);
        }
        return;
      }

      const nextTop = currentTop + (targetTop - currentTop) * SPEED_PTG;
      const dist = Math.abs(targetTop - nextTop);

      // Break if dist grows → user is scrolling manually
      if (scrollDistRef.current !== null && scrollDistRef.current < dist) {
        stopScroll();
        return;
      }
      scrollDistRef.current = dist;

      // Snap when close enough
      if (dist <= 1) {
        ul.scrollTop = targetTop;
        stopScroll();
        return;
      }

      ul.scrollTop = nextTop;
      scrollRafRef.current = requestAnimationFrame(doScroll);
    };

    doScroll();
  }, [ulRef, value, stopScroll]);

  return [startScroll, stopScroll, isScrolling] as const;
}

// ─── Sub: Time Column ──────────────────────────────────

function TimeColumn({
  items,
  selected,
  onSelect,
}: {
  items: number[];
  selected: number;
  onSelect: (val: number) => void;
}) {
  const ulRef = useRef<HTMLUListElement>(null);
  const checkDelayRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const [syncScroll, stopScroll, isScrolling] = useScrollTo(ulRef, selected);

  useLayoutEffect(() => {
    syncScroll();
    clearTimeout(checkDelayRef.current);
    return () => {
      stopScroll();
      clearTimeout(checkDelayRef.current);
    };
  }, [syncScroll, stopScroll]);

  // Scroll-end selection: after user stops scrolling, snap to nearest item
  const handleScroll = useCallback(() => {
    clearTimeout(checkDelayRef.current);
    const ul = ulRef.current;
    if (!ul || isScrolling()) return;

    checkDelayRef.current = setTimeout(() => {
      if (!ul) return;
      const firstLi = ul.querySelector<HTMLLIElement>('li');
      if (!firstLi) return;

      const firstTop = firstLi.offsetTop;
      const liList = Array.from(ul.querySelectorAll<HTMLLIElement>('li'));
      const minDist = liList.reduce(
        (best, li) => {
          const val = li.getAttribute('data-value');
          if (val === null) return best;
          const d = Math.abs(li.offsetTop - firstTop - ul.scrollTop);
          return d < best.dist ? { dist: d, value: val } : best;
        },
        { dist: Number.MAX_SAFE_INTEGER, value: '' },
      );

      const numVal = parseInt(minDist.value, 10);
      if (!Number.isNaN(numVal) && numVal !== selected) {
        onSelect(numVal);
      }
    }, SCROLL_DELAY);
  }, [isScrolling, onSelect, selected]);

  return (
    <div className="relative h-40 w-14">
      {/* Bottom gradient fade only — top item IS the selected value */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-14 bg-gradient-to-t from-popover to-transparent" />
      {/* Scrollable list */}
      <ul
        ref={ulRef}
        className="m-0 h-full list-none overflow-y-auto p-0"
        onScroll={handleScroll}
      >
        {/* Top padding spacers */}
        <li className="h-8" aria-hidden />
        <li className="h-8" aria-hidden />
        {/* Time items */}
        {items.map((item) => {
          const isSelected = item === selected;
          return (
            <li
              key={item}
              data-value={item}
              className={cn(
                'flex h-8 w-full cursor-pointer items-center justify-center text-sm select-none transition-colors',
                isSelected
                  ? 'font-semibold text-primary'
                  : 'text-muted-foreground hover:text-foreground',
              )}
              onClick={() => onSelect(item)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') onSelect(item);
              }}
            >
              {String(item).padStart(2, '0')}
            </li>
          );
        })}
        {/* Bottom padding spacers */}
        <li className="h-8" aria-hidden />
        <li className="h-8" aria-hidden />
      </ul>
    </div>
  );
}

// ─── Sub: Time Header ──────────────────────────────────

function TimeHeader({
  hours,
  minutes,
  seconds,
}: {
  hours: number;
  minutes: number;
  seconds: number;
}) {
  const formatted = useMemo(
    () =>
      `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`,
    [hours, minutes, seconds],
  );

  return (
    <div className="border-b py-1.5 text-center text-sm font-medium tabular-nums">
      {formatted}
    </div>
  );
}

// ─── Sub: Time Columns (HH:mm:ss) ──────────────────────

function TimeColumns({
  hours,
  minutes,
  seconds,
  onChange,
}: {
  hours: number;
  minutes: number;
  seconds: number;
  onChange: (time: { hours: number; minutes: number; seconds: number }) => void;
}) {
  return (
    <div className="flex items-center justify-center gap-0.5 px-2">
      <TimeColumn
        items={HOURS}
        selected={hours}
        onSelect={(val) => onChange({ hours: val, minutes, seconds })}
      />
      <span className="flex h-40 items-center px-0.5 text-base text-muted-foreground">
        :
      </span>
      <TimeColumn
        items={MINUTES}
        selected={minutes}
        onSelect={(val) => onChange({ hours, minutes: val, seconds })}
      />
      <span className="flex h-40 items-center px-0.5 text-base text-muted-foreground">
        :
      </span>
      <TimeColumn
        items={SECONDS}
        selected={seconds}
        onSelect={(val) => onChange({ hours, minutes, seconds: val })}
      />
    </div>
  );
}

// ─── Sub: parse input text ──────────────────────────────

function parseInputText(text: string): Date | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  const d = dayjs(trimmed, [FORMAT_FULL, FORMAT_MINUTE, FORMAT_DATE], true);
  if (d.isValid()) return d.toDate();
  return undefined;
}

// ─── Main: DateTimePicker ──────────────────────────────

interface DateTimePickerProps {
  value?: string;
  onChange?: (value: string | undefined) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  nowLabel?: string;
  okLabel?: string;
}

const DateTimePicker = ({
  value,
  onChange,
  placeholder,
  disabled,
  className,
  nowLabel = '此刻',
  okLabel = '确定',
}: DateTimePickerProps) => {
  const [open, setOpen] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Committed value (from props)
  const committedDayjs = useMemo(() => {
    if (!value) return undefined;
    const d = dayjs(value);
    return d.isValid() ? d : undefined;
  }, [value]);

  // Pending state (while popover is open)
  const [pendingDate, setPendingDate] = useState<Date | undefined>(undefined);
  const [pendingTime, setPendingTime] = useState({
    hours: 0,
    minutes: 0,
    seconds: 0,
  });
  const [inputText, setInputText] = useState('');
  const [calendarMonth, setCalendarMonth] = useState<Date>(new Date());

  // Sync pending state when popover opens
  useEffect(() => {
    if (open) {
      setIsTyping(false);
      if (committedDayjs) {
        const date = committedDayjs.toDate();
        setPendingDate(date);
        setCalendarMonth(date);
        setPendingTime({
          hours: committedDayjs.hour(),
          minutes: committedDayjs.minute(),
          seconds: committedDayjs.second(),
        });
        setInputText(committedDayjs.format(FORMAT_FULL));
      } else {
        setPendingDate(undefined);
        setCalendarMonth(new Date());
        setPendingTime({ hours: 0, minutes: 0, seconds: 0 });
        setInputText('');
      }
    }
  }, [open, committedDayjs]);

  // Cleanup typing timer when popover closes
  useEffect(() => {
    if (!open) {
      setIsTyping(false);
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    }
  }, [open]);

  // Computed display value from pending state
  const displayValue = useMemo(() => {
    if (!pendingDate) return '';
    return dayjs(pendingDate)
      .hour(pendingTime.hours)
      .minute(pendingTime.minutes)
      .second(pendingTime.seconds)
      .format(FORMAT_FULL);
  }, [pendingDate, pendingTime]);

  // Sync inputText with displayValue when NOT typing
  useEffect(() => {
    if (open && !isTyping) {
      setInputText(displayValue);
    }
  }, [displayValue, open, isTyping]);

  // Navigate calendar when pendingDate changes
  useEffect(() => {
    if (pendingDate) {
      setCalendarMonth(pendingDate);
    }
  }, [pendingDate]);

  // ─── Handlers ──────────────────────────────────────

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (disabled) return;
      setOpen(nextOpen);
    },
    [disabled],
  );

  // Date select preserves existing time (antd mergeTime pattern)
  const handleDateSelect = useCallback(
    (date: Date | undefined) => {
      if (!date) return;
      const merged = dayjs(date)
        .hour(pendingTime.hours)
        .minute(pendingTime.minutes)
        .second(pendingTime.seconds)
        .toDate();
      setPendingDate(merged);
    },
    [pendingTime],
  );

  const handleTimeChange = useCallback(
    (time: { hours: number; minutes: number; seconds: number }) => {
      setPendingTime(time);
    },
    [],
  );

  const handleNow = useCallback(() => {
    const now = dayjs();
    setPendingDate(now.toDate());
    setCalendarMonth(now.toDate());
    setPendingTime({
      hours: now.hour(),
      minutes: now.minute(),
      seconds: now.second(),
    });
  }, []);

  const handleOk = useCallback(() => {
    if (!pendingDate) return;
    const result = dayjs(pendingDate)
      .hour(pendingTime.hours)
      .minute(pendingTime.minutes)
      .second(pendingTime.seconds)
      .toISOString();
    onChange?.(result);
    setOpen(false);
  }, [pendingDate, pendingTime, onChange]);

  const handleClear = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onChange?.(undefined);
      setInputText('');
      setPendingDate(undefined);
      setPendingTime({ hours: 0, minutes: 0, seconds: 0 });
    },
    [onChange],
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const text = e.target.value;
      setInputText(text);
      setIsTyping(true);
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
      typingTimerRef.current = setTimeout(() => {
        setIsTyping(false);
        const parsed = parseInputText(text);
        if (parsed) {
          setPendingDate(parsed);
          setPendingTime({
            hours: dayjs(parsed).hour(),
            minutes: dayjs(parsed).minute(),
            seconds: dayjs(parsed).second(),
          });
        }
      }, 800);
    },
    [],
  );

  const handleInputBlur = useCallback(() => {
    if (!open && !isTyping) {
      const parsed = parseInputText(inputText);
      if (parsed) {
        onChange?.(dayjs(parsed).toISOString());
      } else if (inputText.trim() === '') {
        onChange?.(undefined);
      }
    }
  }, [inputText, open, isTyping, onChange]);

  // ─── Derived state ────────────────────────────────

  const selectedCalendarDate = useMemo(() => {
    if (!pendingDate) return undefined;
    return dayjs(pendingDate).startOf('day').toDate();
  }, [pendingDate]);

  const inputDisplay = open
    ? inputText
    : (committedDayjs?.format(FORMAT_FULL) ?? '');

  const showClear = !disabled && (!!committedDayjs || !!pendingDate);

  // ─── Render ────────────────────────────────────────

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <div className={cn('relative flex items-center', className)}>
          <Input
            type="text"
            value={inputDisplay}
            onChange={handleInputChange}
            onBlur={handleInputBlur}
            placeholder={placeholder}
            disabled={disabled}
            className="pr-8"
            onClick={() => {
              if (!open && !disabled) setOpen(true);
            }}
          />
          <div className="pointer-events-none absolute right-2 flex items-center gap-0.5">
            {showClear && (
              <button
                type="button"
                className="pointer-events-auto flex size-5 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground"
                onClick={handleClear}
                tabIndex={-1}
                aria-label="Clear"
              >
                <Icon icon="lucide:x" className="size-3.5" />
              </button>
            )}
            <Icon
              icon="lucide:calendar"
              className={cn(
                'size-4',
                disabled ? 'text-muted-foreground/50' : 'text-muted-foreground',
              )}
            />
          </div>
        </div>
      </PopoverTrigger>
      <PopoverContent
        className="w-auto p-0"
        align="start"
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <div className="flex">
          {/* Calendar on the left */}
          <Calendar
            mode="single"
            month={calendarMonth}
            onMonthChange={setCalendarMonth}
            selected={selectedCalendarDate}
            onSelect={handleDateSelect}
            numberOfMonths={1}
          />
          {/* Time section on the right */}
          <div className="border-l px-3 pt-2">
            <TimeHeader
              hours={pendingTime.hours}
              minutes={pendingTime.minutes}
              seconds={pendingTime.seconds}
            />
            <TimeColumns
              hours={pendingTime.hours}
              minutes={pendingTime.minutes}
              seconds={pendingTime.seconds}
              onChange={handleTimeChange}
            />
          </div>
        </div>
        {/* Footer */}
        <div className="flex items-center justify-between border-t px-3 py-1.5">
          <Button type="button" variant="ghost" size="xs" onClick={handleNow}>
            {nowLabel}
          </Button>
          <Button
            type="button"
            variant="default"
            size="xs"
            onClick={handleOk}
            disabled={!pendingDate}
          >
            {okLabel}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
};

export type { DateTimePickerProps };
export { DateTimePicker };
