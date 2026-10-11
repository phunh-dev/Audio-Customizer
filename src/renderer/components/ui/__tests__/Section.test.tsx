import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { FieldRow, Hint, Section } from '../Section';
import { setEnglish } from '../testUtils';

beforeAll(setEnglish);

describe('Section', () => {
  it('renders title, enable switch and reset button with i18n names', () => {
    const onEnabled = vi.fn();
    const onReset = vi.fn();
    render(
      <Section title="Equalizer" enabled={false} onEnabledChange={onEnabled} onReset={onReset} description="About it">
        <span>content</span>
      </Section>,
    );
    expect(screen.getByRole('region', { name: 'Equalizer' })).toHaveAttribute('data-enabled', 'false');
    fireEvent.click(screen.getByRole('switch', { name: 'Enable Equalizer' }));
    expect(onEnabled).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByRole('button', { name: 'Reset Equalizer to defaults' }));
    expect(onReset).toHaveBeenCalled();
    expect(screen.getByRole('img', { name: 'About Equalizer' })).toBeInTheDocument();
    expect(screen.getByText('content')).toBeInTheDocument();
    // switched off: a hint with a one-click "Turn on"
    expect(screen.getByTestId('section-off')).toHaveTextContent(/off/i);
    fireEvent.click(screen.getByRole('button', { name: 'Turn on' }));
    expect(onEnabled).toHaveBeenLastCalledWith(true);
  });

  it('shows no off hint when enabled', () => {
    render(
      <Section title="EQ" enabled onEnabledChange={() => undefined}>
        x
      </Section>,
    );
    expect(screen.queryByTestId('section-off')).toBeNull();
  });

  it('omits switch and reset when not requested', () => {
    render(<Section title="Plain">x</Section>);
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('FieldRow and Hint render their content', () => {
    render(
      <>
        <FieldRow label="Mode" hint="explain">
          <button type="button">ctl</button>
        </FieldRow>
        <Hint>hint text</Hint>
      </>,
    );
    expect(screen.getByText('Mode')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Mode' })).toBeInTheDocument();
    expect(screen.getByText('hint text')).toBeInTheDocument();
  });
});
