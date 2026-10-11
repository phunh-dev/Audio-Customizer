/**
 * Test helpers for the UI kit / effects / export tests (not used by the app).
 * - initialises i18n (English) so components render real strings
 * - polyfills jsdom gaps used by radix (pointer capture, scrollIntoView)
 */
import i18n from '@renderer/i18n';
import { fireEvent } from '@testing-library/react';

export function installRadixPolyfills(): void {
  const proto = window.HTMLElement.prototype as unknown as Record<string, unknown>;
  if (!proto.hasPointerCapture) proto.hasPointerCapture = () => false;
  if (!proto.setPointerCapture) proto.setPointerCapture = () => undefined;
  if (!proto.releasePointerCapture) proto.releasePointerCapture = () => undefined;
  if (!proto.scrollIntoView) proto.scrollIntoView = () => undefined;
}

installRadixPolyfills();

export async function setEnglish(): Promise<void> {
  if (i18n.language !== 'en') await i18n.changeLanguage('en');
}

export { i18n };

/** Open a radix Select (trigger = combobox) and click the option with `name`. */
export function chooseOption(trigger: HTMLElement, optionName: string | RegExp, within: HTMLElement | Document = document): void {
  fireEvent.keyDown(trigger, { key: 'Enter' });
  const options = Array.from((within as ParentNode).querySelectorAll('[role="option"]'));
  const match = options.find((o) => {
    const text = o.textContent ?? '';
    return typeof optionName === 'string' ? text.includes(optionName) : optionName.test(text);
  });
  if (!match) throw new Error(`option ${String(optionName)} not found in [${options.map((o) => o.textContent).join(', ')}]`);
  fireEvent.click(match);
}

/** Simulate a pointer drag on an element (vertical, positive dy = upwards). */
export function dragVertical(el: HTMLElement, dy: number, opts: { shiftKey?: boolean; steps?: number } = {}): void {
  const steps = opts.steps ?? 4;
  fireEvent.pointerDown(el, { button: 0, clientY: 300, pointerId: 1 });
  for (let i = 1; i <= steps; i++) {
    fireEvent.pointerMove(el, { clientY: 300 - (dy * i) / steps, pointerId: 1, shiftKey: opts.shiftKey });
  }
  fireEvent.pointerUp(el, { clientY: 300 - dy, pointerId: 1 });
}
