/**
 * Design-token class fragments used by the UI kit. Every colour reads a CSS
 * variable from the design tokens with a dark-theme fallback, so the kit
 * renders correctly even before/without the global stylesheet.
 *
 * Keep the class names as full literals (Tailwind scans the source).
 */
export const tw = {
  // surfaces
  bg: 'bg-[var(--color-bg,#0e1016)]',
  surface: 'bg-[var(--color-surface,#151821)]',
  surface2: 'bg-[var(--color-surface-2,#1c2030)]',
  surface3: 'bg-[var(--color-surface-3,#252a3c)]',
  hoverSurface: 'hover:bg-[var(--color-surface-3,#252a3c)]',
  // borders
  border: 'border-[var(--color-border,#2a3044)]',
  borderStrong: 'border-[var(--color-border-strong,#3a4260)]',
  // text
  fg: 'text-[var(--color-fg,#e7eaf3)]',
  fgMuted: 'text-[var(--color-fg-muted,#9aa3b9)]',
  fgSubtle: 'text-[var(--color-fg-subtle,#6c7590)]',
  // accent
  accentBg: 'bg-[var(--color-accent,#7c6cff)]',
  accentText: 'text-[var(--color-accent,#7c6cff)]',
  accentBorder: 'border-[var(--color-accent,#7c6cff)]',
  accentFg: 'text-[var(--color-accent-fg,#ffffff)]',
  dangerBg: 'bg-[var(--color-danger,#ef5350)]',
  dangerText: 'text-[var(--color-danger,#ef5350)]',
  successText: 'text-[var(--color-success,#35d39a)]',
  warningText: 'text-[var(--color-warning,#f5b942)]',
  // focus ring
  focus:
    'outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent,#7c6cff)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--color-bg,#0e1016)]',
  mono: 'font-mono tabular-nums',
} as const;

/** Raw CSS colours for canvas drawing (read at draw time from CSS variables). */
export function cssVar(name: string, fallback: string, el?: Element | null): string {
  if (typeof window === 'undefined' || typeof getComputedStyle !== 'function') return fallback;
  const v = getComputedStyle(el ?? document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}
