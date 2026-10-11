import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Select } from '../Select';
import { Switch } from '../Switch';
import { SegmentedControl } from '../SegmentedControl';
import { Tooltip, InfoTip } from '../Tooltip';
import { Button, IconButton } from '../Button';
import { chooseOption } from '../testUtils';

describe('Select', () => {
  it('shows the current value and changes on choice', () => {
    function S() {
      const [v, setV] = useState<'a' | 'b'>('a');
      return (
        <Select
          aria-label="Letter"
          value={v}
          onValueChange={setV}
          options={[
            { value: 'a', label: 'Alpha' },
            { value: 'b', label: 'Beta', description: 'second letter' },
          ]}
        />
      );
    }
    render(<S />);
    const trigger = screen.getByRole('combobox', { name: 'Letter' });
    expect(trigger).toHaveTextContent('Alpha');
    chooseOption(trigger, 'Beta');
    expect(screen.getByRole('combobox', { name: 'Letter' })).toHaveTextContent('Beta');
  });

  it('is disabled when requested', () => {
    render(<Select aria-label="X" value="a" disabled onValueChange={() => undefined} options={[{ value: 'a', label: 'A' }]} />);
    expect(screen.getByRole('combobox', { name: 'X' })).toBeDisabled();
  });
});

describe('Switch', () => {
  it('toggles with click and exposes switch semantics', () => {
    const onChange = vi.fn();
    render(<Switch label="Limiter" checked={false} onCheckedChange={onChange} hint="Explanation" />);
    const sw = screen.getByRole('switch', { name: 'Limiter' });
    expect(sw).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(sw);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('label click toggles; aria-label without visible label', () => {
    const onChange = vi.fn();
    render(
      <>
        <Switch label="Visible" checked onCheckedChange={onChange} />
        <Switch aria-label="Hidden label" checked={false} onCheckedChange={() => undefined} size="sm" />
      </>,
    );
    fireEvent.click(screen.getByText('Visible'));
    expect(onChange).toHaveBeenCalledWith(false);
    expect(screen.getByRole('switch', { name: 'Hidden label' })).toBeInTheDocument();
  });
});

describe('SegmentedControl', () => {
  it('selects one option and never deselects', () => {
    function S() {
      const [v, setV] = useState<'off' | 'peak' | 'lufs'>('off');
      return (
        <SegmentedControl
          aria-label="Normalize"
          value={v}
          onValueChange={setV}
          options={[
            { value: 'off', label: 'Off' },
            { value: 'peak', label: 'Peak' },
            { value: 'lufs', label: 'LUFS' },
          ]}
        />
      );
    }
    render(<S />);
    expect(screen.getByRole('radiogroup', { name: 'Normalize' })).toBeInTheDocument();
    const peak = screen.getByRole('radio', { name: 'Peak' });
    fireEvent.click(peak);
    expect(peak).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(peak); // clicking the active one keeps it
    expect(peak).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'Off' })).toHaveAttribute('aria-checked', 'false');
  });

  it('arrow keys move focus between segments', async () => {
    render(
      <SegmentedControl
        aria-label="Mode"
        value="a"
        onValueChange={() => undefined}
        options={[
          { value: 'a', label: 'A' },
          { value: 'b', label: 'B' },
        ]}
      />,
    );
    const a = screen.getByRole('radio', { name: 'A' });
    a.focus();
    fireEvent.keyDown(a, { key: 'ArrowRight' });
    await waitFor(() => expect(screen.getByRole('radio', { name: 'B' })).toHaveFocus());
  });
});

describe('Tooltip', () => {
  it('shows translated content on focus', async () => {
    render(
      <Tooltip content="Helpful text">
        <button type="button">Target</button>
      </Tooltip>,
    );
    fireEvent.focus(screen.getByRole('button', { name: 'Target' }));
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Helpful text');
  });

  it('renders the child alone without content', () => {
    render(
      <Tooltip content="">
        <button type="button">Only</button>
      </Tooltip>,
    );
    fireEvent.focus(screen.getByRole('button', { name: 'Only' }));
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('InfoTip is a focusable labelled icon', async () => {
    render(<InfoTip label="About gain" content="Gain explanation" />);
    const icon = screen.getByRole('img', { name: 'About gain' });
    expect(icon).toHaveAttribute('tabindex', '0');
    fireEvent.focus(icon);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Gain explanation');
  });
});

describe('Button / IconButton', () => {
  it('Button renders children, icon and handles clicks', () => {
    const onClick = vi.fn();
    render(
      <Button variant="primary" icon={<span data-testid="icon" />} onClick={onClick}>
        Export
      </Button>,
    );
    const b = screen.getByRole('button', { name: 'Export' });
    expect(b).toHaveAttribute('type', 'button');
    expect(screen.getByTestId('icon')).toBeInTheDocument();
    fireEvent.click(b);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('disabled Button does not fire', () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        No
      </Button>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'No' }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('IconButton uses the label as accessible name and tooltip, supports pressed', async () => {
    render(<IconButton label="Reset" icon={<svg />} pressed />);
    const b = screen.getByRole('button', { name: 'Reset' });
    expect(b).toHaveAttribute('aria-pressed', 'true');
    fireEvent.focus(b);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Reset');
  });
});
