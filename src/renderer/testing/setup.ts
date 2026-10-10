/**
 * Global test setup for renderer tests (jsdom).
 * - jest-dom matchers
 * - a fresh mock `window.api` before each test (available as `globalThis.mockApi`)
 * - Canvas 2D / ResizeObserver / matchMedia stubs that jsdom lacks
 */
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach } from 'vitest';
import { installMockApi, type MockAudioApi } from './mockApi';

declare global {
  var mockApi: MockAudioApi;
}

class ResizeObserverStub {
  private cb: ResizeObserverCallback;
  constructor(cb: ResizeObserverCallback) {
    this.cb = cb;
  }
  observe(target: Element): void {
    this.cb([{ target, contentRect: target.getBoundingClientRect() } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver);
  }
  unobserve(): void {}
  disconnect(): void {}
}

if (!('ResizeObserver' in globalThis)) {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
}

if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

// Radix primitives (Select, Slider) rely on these DOM APIs that jsdom lacks.
const elementProto = Element.prototype as unknown as Record<string, unknown>;
if (!elementProto.scrollIntoView) elementProto.scrollIntoView = function scrollIntoView() {};
if (!elementProto.hasPointerCapture) elementProto.hasPointerCapture = () => false;
if (!elementProto.setPointerCapture) elementProto.setPointerCapture = () => undefined;
if (!elementProto.releasePointerCapture) elementProto.releasePointerCapture = () => undefined;

/** Minimal 2D context recording calls; enough for drawing code to run. */
export function createFakeContext2D(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const calls: string[] = [];
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(target, prop: string) {
      if (prop === 'canvas') return canvas;
      if (prop === '__calls') return calls;
      if (prop in target) return target[prop];
      if (prop === 'createImageData') return (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) });
      if (prop === 'measureText') return (s: string) => ({ width: s.length * 6 });
      if (prop === 'createLinearGradient') return () => ({ addColorStop: () => undefined });
      if (prop === 'getImageData') return (_x: number, _y: number, w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) });
      return (...args: unknown[]) => {
        calls.push(`${prop}(${args.length})`);
      };
    },
    set(target, prop: string, value) {
      target[prop] = value;
      return true;
    },
  };
  return new Proxy({}, handler) as unknown as CanvasRenderingContext2D;
}

const contexts = new WeakMap<HTMLCanvasElement, CanvasRenderingContext2D>();
HTMLCanvasElement.prototype.getContext = function getContext(this: HTMLCanvasElement, kind: string) {
  if (kind !== '2d') return null;
  let ctx = contexts.get(this);
  if (!ctx) {
    ctx = createFakeContext2D(this);
    contexts.set(this, ctx);
  }
  return ctx;
} as unknown as HTMLCanvasElement['getContext'];

if (typeof globalThis.ImageData === 'undefined') {
  (globalThis as unknown as { ImageData: unknown }).ImageData = class {
    data: Uint8ClampedArray;
    width: number;
    height: number;
    constructor(data: Uint8ClampedArray | number, w: number, h?: number) {
      if (typeof data === 'number') {
        this.width = data;
        this.height = w;
        this.data = new Uint8ClampedArray(data * w * 4);
      } else {
        this.data = data;
        this.width = w;
        this.height = h ?? data.length / 4 / w;
      }
    }
  };
}

beforeEach(() => {
  try {
    localStorage.clear();
  } catch {
    // ignore
  }
  globalThis.mockApi = installMockApi();
});

afterEach(() => {
  cleanup();
});
