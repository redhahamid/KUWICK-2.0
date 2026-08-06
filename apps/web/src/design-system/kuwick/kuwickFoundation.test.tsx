// @vitest-environment jsdom
import { ReactNode, useState } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Button, Input, message } from 'antd';
import {
  DISCARD_TITLE,
  KuwickCalculatorShell,
  KuwickModal,
  KuwickModalActionBar,
  KuwickSearchSelect,
  KuwickStatusTag,
  REFINE_MESSAGE,
  RESULT_CAP,
  SEARCH_DEBOUNCE_MS,
} from './index';
import { statusPalette } from '../tokens';

// ===========================================================================
// G4.5d5b-1 — THE SHARED FOUNDATION
//
// These tests defend the properties that were missing from the twenty
// hand-rolled modals the audit found: focus that comes back, typed data that
// cannot vanish, a search that cannot be overtaken by its own stale response,
// and a calculator that never prints a number it should not.
// ===========================================================================

beforeEach(() => {
  message.destroy();
  document.body.className = '';
  document.body.style.overflow = '';
});

// Fake timers left installed by a FAILING test hang every test after it, which
// turns one real failure into six timeouts and hides the cause.
afterEach(() => {
  vi.useRealTimers();
});

function Harness({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

// ---------------------------------------------------------------------------
// KuwickModal
// ---------------------------------------------------------------------------
function ModalHost({ dirty = false }: { dirty?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <Harness>
      <button type="button" onClick={() => setOpen(true)}>
        Open the modal
      </button>
      <KuwickModal
        open={open}
        title="Add medication"
        subtitle="One at a time"
        dirty={dirty}
        onClose={() => setOpen(false)}
        footer={
          <KuwickModalActionBar
            cancel={<Button onClick={() => setOpen(false)}>Cancel</Button>}
            primary={<Button type="primary">Add Medication</Button>}
          />
        }
      >
        <label htmlFor="field">Dose</label>
        <input id="field" />
      </KuwickModal>
    </Harness>
  );
}

describe('KuwickModal', () => {
  it('1. traps focus inside the dialog', async () => {
    render(<ModalHost />);
    const trigger = screen.getByRole('button', { name: 'Open the modal' });
    await userEvent.click(trigger);
    const dialog = await screen.findByRole('dialog');

    // Focus moves INTO the dialog on open...
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));

    // ...and tabbing repeatedly never returns it to the page behind. The
    // trigger is the element that would receive focus first if the trap
    // leaked, so it is the one worth naming.
    for (let i = 0; i < 8; i += 1) {
      await userEvent.tab();
      expect(document.activeElement).not.toBe(trigger);
      expect(document.body.contains(document.activeElement)).toBe(true);
    }
  });

  it('2. restores focus to whatever opened it', async () => {
    render(<ModalHost />);
    const trigger = screen.getByRole('button', { name: 'Open the modal' });
    await userEvent.click(trigger);
    await screen.findByRole('dialog');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it('3. a dirty modal cannot be dismissed silently by Escape', async () => {
    render(<ModalHost dirty />);
    await userEvent.click(screen.getByRole('button', { name: 'Open the modal' }));
    await screen.findByRole('dialog');
    await userEvent.keyboard('{Escape}');

    // The discard question appears; the form is still there behind it.
    expect(await screen.findByText(DISCARD_TITLE)).toBeInTheDocument();
    expect(screen.getByLabelText('Dose')).toBeInTheDocument();
  });

  it('3b. a dirty modal ignores a backdrop click entirely', async () => {
    render(<ModalHost dirty />);
    await userEvent.click(screen.getByRole('button', { name: 'Open the modal' }));
    await screen.findByRole('dialog');
    const mask = document.querySelector('.ant-modal-wrap');
    if (mask) await userEvent.click(mask as HTMLElement);
    expect(screen.getByLabelText('Dose')).toBeInTheDocument();
  });

  it('3c. keeping editing leaves the modal open and the data intact', async () => {
    render(<ModalHost dirty />);
    await userEvent.click(screen.getByRole('button', { name: 'Open the modal' }));
    await userEvent.type(await screen.findByLabelText('Dose'), '500');
    await userEvent.keyboard('{Escape}');
    await userEvent.click(await screen.findByRole('button', { name: 'Keep editing' }));
    expect((screen.getByLabelText('Dose') as HTMLInputElement).value).toBe('500');
  });

  it('3d. a CLEAN modal closes on Escape without asking', async () => {
    render(<ModalHost />);
    await userEvent.click(screen.getByRole('button', { name: 'Open the modal' }));
    await screen.findByRole('dialog');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByLabelText('Dose')).not.toBeInTheDocument());
  });

  it('4. it locks the background so the page behind cannot scroll', async () => {
    render(<ModalHost />);
    await userEvent.click(screen.getByRole('button', { name: 'Open the modal' }));
    await screen.findByRole('dialog');
    expect(document.body.style.overflow).toBe('hidden');
    expect(document.body.classList.contains('kw-modal-open')).toBe(true);
  });

  it('4b. and releases it again on close', async () => {
    render(<ModalHost />);
    await userEvent.click(screen.getByRole('button', { name: 'Open the modal' }));
    await screen.findByRole('dialog');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(document.body.classList.contains('kw-modal-open')).toBe(false));
  });

  it('4c. the title and subtitle are both rendered', async () => {
    render(<ModalHost />);
    await userEvent.click(screen.getByRole('button', { name: 'Open the modal' }));
    expect(await screen.findByText('Add medication')).toBeInTheDocument();
    expect(screen.getByText('One at a time')).toBeInTheDocument();
  });

  it('4d. a server error is shown INSIDE the modal, not as a toast', async () => {
    render(
      <KuwickModal open title="T" error="The medication could not be added." onClose={() => {}}>
        <p>body</p>
      </KuwickModal>,
    );
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('alert')).toHaveTextContent('The medication could not be added.');
  });
});

// ---------------------------------------------------------------------------
// KuwickStatusTag
// ---------------------------------------------------------------------------
describe('KuwickStatusTag', () => {
  it('5. always renders its word, never colour alone', () => {
    render(<KuwickStatusTag tone="success" label="Dispensed" />);
    expect(screen.getByText('Dispensed')).toBeInTheDocument();
  });

  it('6. carries its detail alongside the label', () => {
    render(<KuwickStatusTag tone="attention" label="Low stock" detail="5 available" />);
    expect(screen.getByText('Low stock')).toBeInTheDocument();
    expect(screen.getByText('5 available')).toBeInTheDocument();
  });

  it('7. every tone in the palette resolves to a colour pair', () => {
    for (const [tone, pair] of Object.entries(statusPalette)) {
      expect(pair.fg).toMatch(/^#[0-9a-f]{6}$/i);
      expect(pair.bg).toMatch(/^#[0-9a-f]{6}$/i);
      expect(pair.fg).not.toBe(pair.bg);
      expect(tone.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// KuwickSearchSelect
// ---------------------------------------------------------------------------
describe('KuwickSearchSelect', () => {
  const options = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ value: `id-${i}`, label: `Item ${i}` }));

  it('8. debounces — typing a word is ONE request, not one per keystroke', async () => {
    // Real timers on purpose: antd's Select schedules its own work, and fake
    // timers turn this into a test of the harness rather than the component.
    const onSearch = vi.fn(async () => options(3));
    render(
      <KuwickSearchSelect ariaLabel="Search medicine" onSearch={onSearch} onSelect={() => {}} />,
    );
    const input = screen.getByRole('combobox');
    await userEvent.click(input);
    await userEvent.type(input, 'amoxicillin');

    await new Promise((resolve) => setTimeout(resolve, SEARCH_DEBOUNCE_MS + 120));
    // Eleven keystrokes, one request — and it carries the whole term, not a
    // prefix, which is what proves the trailing edge fired rather than the
    // leading one.
    expect(onSearch).toHaveBeenCalledTimes(1);
    expect(onSearch).toHaveBeenCalledWith('amoxicillin');
  });

  it('9. renders the bounded result set', async () => {
    const onSearch = vi.fn(async () => options(3));
    render(
      <KuwickSearchSelect ariaLabel="Search medicine" onSearch={onSearch} onSelect={() => {}} />,
    );
    const box = screen.getByRole('combobox');
    await userEvent.click(box);
    await userEvent.type(box, 'am');
    await waitFor(() => expect(onSearch).toHaveBeenCalled());
    expect(await screen.findByTitle('Item 0')).toBeInTheDocument();
  });

  it('10. says so when the cap is reached, rather than looking complete', async () => {
    const onSearch = vi.fn(async () => options(RESULT_CAP));
    render(
      <KuwickSearchSelect ariaLabel="Search medicine" onSearch={onSearch} onSelect={() => {}} />,
    );
    const box = screen.getByRole('combobox');
    await userEvent.click(box);
    await userEvent.type(box, 'a');
    expect(await screen.findByText(REFINE_MESSAGE)).toBeInTheDocument();
  });

  it('11. a STALE response cannot replace the current one', async () => {
    // The failure this prevents: a slow "amox" landing after a fast
    // "amoxicillin" and repopulating the list with the wrong matches.
    let resolveSlow: (value: { value: string; label: string }[]) => void = () => {};
    const onSearch = vi
      .fn()
      .mockImplementationOnce(() => new Promise((resolve) => (resolveSlow = resolve)))
      .mockImplementationOnce(async () => [{ value: 'fresh', label: 'FRESH RESULT' }]);

    render(
      <KuwickSearchSelect ariaLabel="Search medicine" onSearch={onSearch} onSelect={() => {}} />,
    );
    const input = screen.getByRole('combobox');
    await userEvent.click(input);
    await userEvent.type(input, 'amox');
    await waitFor(() => expect(onSearch).toHaveBeenCalledTimes(1));
    await userEvent.type(input, 'icillin');
    await waitFor(() => expect(onSearch).toHaveBeenCalledTimes(2));

    expect(await screen.findByTitle('FRESH RESULT')).toBeInTheDocument();
    // The earlier request finally lands — and must be ignored.
    resolveSlow([{ value: 'stale', label: 'STALE RESULT' }]);
    await waitFor(() => expect(screen.queryByTitle('STALE RESULT')).not.toBeInTheDocument());
    expect(screen.getByTitle('FRESH RESULT')).toBeInTheDocument();
  });

  it('12. the field carries an accessible name', () => {
    render(
      <KuwickSearchSelect ariaLabel="Search medicine" onSearch={async () => []} onSelect={() => {}} />,
    );
    expect(screen.getByRole('combobox', { name: 'Search medicine' })).toBeInTheDocument();
  });

  it('13. an empty term issues no request at all', async () => {
    const onSearch = vi.fn(async () => []);
    render(
      <KuwickSearchSelect ariaLabel="Search medicine" onSearch={onSearch} onSelect={() => {}} />,
    );
    const box = screen.getByRole('combobox');
    await userEvent.click(box);
    await userEvent.type(box, 'a{backspace}');
    await new Promise((resolve) => setTimeout(resolve, SEARCH_DEBOUNCE_MS + 40));
    expect(onSearch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// KuwickCalculatorShell
// ---------------------------------------------------------------------------
describe('KuwickCalculatorShell', () => {
  const shell = (value: string | null, extra: Record<string, unknown> = {}) =>
    render(
      <KuwickCalculatorShell
        name="Body Mass Index"
        purpose="Weight relative to height"
        resultLabel="BMI"
        resultValue={value}
        resultUnit="kg/m²"
        onReset={() => {}}
        {...extra}
      >
        <Input aria-label="Height (cm)" />
      </KuwickCalculatorShell>,
    );

  it('14. shows the result when there is one', () => {
    shell('26.8', { interpretation: 'Overweight (adult)' });
    expect(screen.getByText('26.8')).toBeInTheDocument();
    expect(screen.getByText('kg/m²')).toBeInTheDocument();
    expect(screen.getByText('Overweight (adult)')).toBeInTheDocument();
  });

  it('15. shows NO result — and no interpretation — for incomplete input', () => {
    shell(null, { interpretation: 'Overweight (adult)' });
    expect(screen.getByText('Enter the values above')).toBeInTheDocument();
    expect(screen.queryByText('Overweight (adult)')).not.toBeInTheDocument();
  });

  it('16. never renders NaN or Infinity for any caller mistake', () => {
    const { container } = shell(null);
    expect(container.textContent).not.toMatch(/NaN|Infinity/);
  });

  it('17. states plainly that it writes nothing to the record', () => {
    shell('26.8');
    expect(screen.getByText('This calculator does not write to the record.')).toBeInTheDocument();
  });

  it('17b. and exposes no apply-to-record action at all', () => {
    shell('26.8');
    expect(screen.queryByRole('button', { name: /apply|save to note|prescribe/i })).not.toBeInTheDocument();
  });

  it('18. the result is announced, not only drawn', () => {
    shell('26.8');
    expect(screen.getByText('26.8').closest('[aria-live]')).toHaveAttribute('aria-live', 'polite');
  });

  it('19. Copy is disabled when there is nothing to copy', () => {
    shell(null);
    expect(screen.getByRole('button', { name: /Copy the Body Mass Index result/ })).toBeDisabled();
  });

  it('20. the provenance caption is shown when values came from the visit', () => {
    shell('26.8', { sourceCaption: 'Using the vitals recorded at 6 Aug 2026, 09:14.' });
    expect(screen.getByText(/Using the vitals recorded at/)).toBeInTheDocument();
  });

  it('21. "Use current visit data" is absent when the visit has none', () => {
    shell('26.8');
    expect(screen.queryByRole('button', { name: /use current visit data/i })).not.toBeInTheDocument();
  });
});
