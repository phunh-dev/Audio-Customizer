import { useEffect, useId, useRef, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { posToValue, valueToPos } from '@renderer/lib/dsp/scale';
import { cn } from './cn';
import { tw } from './theme';
import { defaultFormat, dragPosition, normalizeValue, nudge, type RangeSpec } from './valueMath';

export interface KnobProps extends RangeSpec {
  value: number;
  onChange: (value: number) => void;
  /** End of a gesture (pointer up, key press, wheel idle, reset). */
  onCommit?: (value: number) => void;
  defaultValue?: number;
  label?: ReactNode;
  'aria-label'?: string;
  unit?: string;
  format?: (value: number) => string;
  /** Arc drawn from this value (default: min; bipolar knobs use 0). */
  origin?: number;
  size?: number;
  disabled?: boolean;
  className?: string;
}

const START_ANGLE = -135;
const SWEEP = 270;
const WHEEL_COMMIT_MS = 400;

function polar(cx: number, cy: number, r: number, deg: number) {
  const a = ((deg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}

function arcPath(cx: number, cy: number, r: number, from: number, to: number): string {
  if (Math.abs(to - from) < 0.01) return '';
  const a = Math.min(from, to);
  const b = Math.max(from, to);
  const s = polar(cx, cy, r, a);
  const e = polar(cx, cy, r, b);
  const large = b - a > 180 ? 1 : 0;
  return `M ${s.x} ${s.y} A ${r} ${r} 0 ${large} 1 ${e.x} ${e.y}`;
}

/**
 * Rotary knob. Drag vertically (Shift = fine), mouse wheel, arrow keys
 * (PageUp/PageDown = large, Home/End = limits), double-click resets.
 */
export function Knob({
  value,
  onChange,
  onCommit,
  min,
  max,
  step,
  scale = 'linear',
  defaultValue,
  label,
  unit,
  format,
  origin,
  size = 44,
  disabled,
  className,
  ...aria
}: KnobProps) {
  const range: RangeSpec = { min, max, step, scale };
  const labelId = useId();
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; pos: number; last: number; moved: boolean } | null>(null);
  const wheelTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ value, onChange, onCommit, range, disabled });
  latest.current = { value, onChange, onCommit, range, disabled };

  const text = format ? format(value) : defaultFormat(value, step);
  const pos = valueToPos(value, min, max, scale);
  const originPos = origin === undefined ? 0 : valueToPos(origin, min, max, scale);
  const angle = START_ANGLE + pos * SWEEP;
  const originAngle = START_ANGLE + originPos * SWEEP;

  const set = (v: number, commit: boolean) => {
    if (v !== latest.current.value) onChange(v);
    if (commit) onCommit?.(v);
  };

  // Native non-passive wheel listener so the panel does not scroll.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const cur = latest.current;
      if (cur.disabled || e.deltaY === 0) return;
      e.preventDefault();
      const next = nudge(cur.value, e.deltaY < 0 ? 1 : -1, cur.range, { fine: e.shiftKey });
      if (next !== cur.value) {
        cur.value = next;
        cur.onChange(next);
      }
      if (wheelTimer.current) clearTimeout(wheelTimer.current);
      wheelTimer.current = setTimeout(() => {
        wheelTimer.current = null;
        latest.current.onCommit?.(latest.current.value);
      }, WHEEL_COMMIT_MS);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
      if (wheelTimer.current) clearTimeout(wheelTimer.current);
    };
  }, []);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (disabled || e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.focus();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = { y: e.clientY, pos: valueToPos(value, min, max, scale), last: value, moved: false };
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    // integrate the movement in position space (unsnapped) so fine drags
    // accumulate sub-step motion and toggling Shift never jumps
    d.pos = dragPosition(d.pos, d.y - e.clientY, e.shiftKey);
    d.y = e.clientY;
    const v = normalizeValue(posToValue(d.pos, min, max, scale), range);
    if (v !== d.last) {
      d.last = v;
      d.moved = true;
      onChange(v);
    }
  };
  const endDrag = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    if (d.moved) onCommit?.(d.last);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    let next: number | null = null;
    switch (e.key) {
      case 'ArrowUp':
      case 'ArrowRight':
        next = nudge(value, 1, range, { fine: e.shiftKey });
        break;
      case 'ArrowDown':
      case 'ArrowLeft':
        next = nudge(value, -1, range, { fine: e.shiftKey });
        break;
      case 'PageUp':
        next = nudge(value, 1, range, { large: true });
        break;
      case 'PageDown':
        next = nudge(value, -1, range, { large: true });
        break;
      case 'Home':
        next = normalizeValue(min, range);
        break;
      case 'End':
        next = normalizeValue(max, range);
        break;
      default:
        return;
    }
    e.preventDefault();
    set(next, true);
  };

  const onDoubleClick = () => {
    if (disabled || defaultValue === undefined) return;
    set(defaultValue, true);
  };

  const r = size / 2 - 4;
  const c = size / 2;
  const ind = polar(c, c, r - 5, angle);
  const ind0 = polar(c, c, r * 0.25, angle);

  return (
    <div className={cn('inline-flex flex-col items-center gap-1', disabled && 'opacity-40', className)}>
      <div
        ref={ref}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={aria['aria-label']}
        aria-labelledby={aria['aria-label'] ? undefined : label ? labelId : undefined}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={unit ? `${text} ${unit}` : text}
        aria-disabled={disabled || undefined}
        aria-orientation="vertical"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={onKeyDown}
        onDoubleClick={onDoubleClick}
        className={cn('group cursor-ns-resize touch-none rounded-full', tw.focus)}
        style={{ width: size, height: size }}
      >
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
          <path
            d={arcPath(c, c, r, START_ANGLE, START_ANGLE + SWEEP)}
            fill="none"
            stroke="var(--color-border-strong,#39416e)"
            strokeOpacity={0.7}
            strokeWidth={3.5}
            strokeLinecap="round"
          />
          <path
            d={arcPath(c, c, r, originAngle, angle)}
            fill="none"
            stroke="var(--color-accent,#7c6cff)"
            strokeWidth={3.5}
            strokeLinecap="round"
          />
          <circle
            cx={c}
            cy={c}
            r={r - 4}
            fill="var(--color-surface-2,#171b34)"
            stroke="var(--color-border,#252b4a)"
            className="transition-[fill] group-hover:fill-[var(--color-surface-3,#212746)]"
          />
          <line x1={ind0.x} y1={ind0.y} x2={ind.x} y2={ind.y} stroke="var(--color-fg,#e7eaf3)" strokeWidth={2} strokeLinecap="round" />
        </svg>
      </div>
      <span className={cn('text-[10px] leading-none', tw.fg, tw.mono)}>
        {text}
        {unit ? <span className={tw.fgSubtle}> {unit}</span> : null}
      </span>
      {label ? (
        <span id={labelId} className={cn('line-clamp-2 max-w-28 text-center text-[10px] leading-tight', tw.fgMuted)}>
          {label}
        </span>
      ) : null}
    </div>
  );
}

export default Knob;
