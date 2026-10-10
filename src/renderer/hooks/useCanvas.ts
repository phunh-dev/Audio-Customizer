import { useEffect, useRef, useState, type RefObject } from 'react';

export interface Size {
  width: number;
  height: number;
}

/** Observe the content-box size of an element. */
export function useElementSize<T extends HTMLElement>(): [RefObject<T | null>, Size] {
  const ref = useRef<T>(null);
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = (): void => {
      const r = el.getBoundingClientRect();
      const w = Math.round(r.width || el.clientWidth);
      const h = Math.round(r.height || el.clientHeight);
      setSize((prev) => (prev.width === w && prev.height === h ? prev : { width: w, height: h }));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size];
}

/**
 * Current devicePixelRatio; re-renders when it changes (window moved to a
 * monitor with another scale factor, or zoom) so canvases are redrawn sharp.
 */
export function useDevicePixelRatio(): number {
  const read = (): number => (typeof window !== 'undefined' ? Math.max(1, window.devicePixelRatio || 1) : 1);
  const [dpr, setDpr] = useState(read);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    let mq: MediaQueryList | null = null;
    const listen = (): void => {
      mq = window.matchMedia(`(resolution: ${read()}dppx)`);
      mq.addEventListener?.('change', onChange);
    };
    const onChange = (): void => {
      mq?.removeEventListener?.('change', onChange);
      setDpr(read());
      listen();
    };
    listen();
    return () => mq?.removeEventListener?.('change', onChange);
  }, []);
  return dpr;
}

/**
 * Prepare a canvas for HiDPI drawing at a CSS size; returns the 2D context
 * with a transform so drawing uses CSS pixels.
 */
export function prepareCanvas(canvas: HTMLCanvasElement, width: number, height: number): CanvasRenderingContext2D | null {
  const dpr = typeof window !== 'undefined' ? Math.max(1, window.devicePixelRatio || 1) : 1;
  const w = Math.max(1, Math.round(width * dpr));
  const h = Math.max(1, Math.round(height * dpr));
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  return ctx;
}

/** Read a CSS custom property (canvas colours follow the theme). */
export function themeColor(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}
