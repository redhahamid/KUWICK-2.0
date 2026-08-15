// @vitest-environment jsdom
import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { KuwickModal, DISCARD_TITLE } from './KuwickModal';

// ===========================================================================
// b1 PHASE B — FOUR WAYS OUT, ONE ANSWER.
//
// Escape, the X, Cancel and the backdrop are four routes to the same decision.
// A modal holding a half-written prescription must answer all four the same
// way, and the defect this file is really about is the fourth one: a doctor
// selecting text inside the modal, releasing the mouse a few pixels outside
// it, and losing the form — because a `click` resolves to the common ancestor
// of press and release, which is the mask.
// ===========================================================================

function Harness({ dirty, onClose }: { dirty: boolean; onClose: () => void }) {
  const [open, setOpen] = useState(true);
  return (
    <KuwickModal
      open={open}
      title="Add medication"
      dirty={dirty}
      onClose={() => {
        setOpen(false);
        onClose();
      }}
      footer={<button type="button">Add</button>}
    >
      <label htmlFor="dose">Dose</label>
      <input id="dose" defaultValue="2 tablets" />
    </KuwickModal>
  );
}

/** antd renders the mask and the dialog inside one wrapper; this is it. */
const backdrop = () => document.querySelector('.ant-modal-wrap') as HTMLElement;

describe('a clean modal closes on every route without asking', () => {
  it('Escape closes it', async () => {
    const onClose = vi.fn();
    render(<Harness dirty={false} onClose={onClose} />);
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('a backdrop press-and-release closes it', async () => {
    const onClose = vi.fn();
    render(<Harness dirty={false} onClose={onClose} />);
    const mask = backdrop();
    fireEvent.mouseDown(mask, { target: mask });
    fireEvent.mouseUp(mask, { target: mask });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });
});

describe('a DIRTY modal asks first — on every route, including the backdrop', () => {
  it('Escape asks rather than closing', async () => {
    const onClose = vi.fn();
    render(<Harness dirty onClose={onClose} />);
    await userEvent.keyboard('{Escape}');
    expect(await screen.findByText(DISCARD_TITLE)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('the X asks rather than closing', async () => {
    const onClose = vi.fn();
    render(<Harness dirty onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(await screen.findByText(DISCARD_TITLE)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('the BACKDROP asks rather than doing nothing at all', async () => {
    // It used to be inert while dirty. Safe, but it left a doctor clicking a
    // dead area with nothing explaining why. Asking is both safer and honest:
    // no route silently discards, and no route silently does nothing.
    const onClose = vi.fn();
    render(<Harness dirty onClose={onClose} />);
    const mask = backdrop();
    fireEvent.mouseDown(mask, { target: mask });
    fireEvent.mouseUp(mask, { target: mask });
    expect(await screen.findByText(DISCARD_TITLE)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('"Keep editing" leaves the form exactly as it was', async () => {
    const onClose = vi.fn();
    render(<Harness dirty onClose={onClose} />);
    await userEvent.keyboard('{Escape}');
    await userEvent.click(await screen.findByRole('button', { name: 'Keep editing' }));

    await waitFor(() => expect(screen.queryByText(DISCARD_TITLE)).not.toBeInTheDocument());
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Dose')).toHaveValue('2 tablets');
  });

  it('"Discard changes" is the only thing that actually closes it', async () => {
    const onClose = vi.fn();
    render(<Harness dirty onClose={onClose} />);
    await userEvent.keyboard('{Escape}');
    await userEvent.click(await screen.findByRole('button', { name: 'Discard changes' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });
});

describe('a text selection that ends outside the modal does NOT close it', () => {
  it('a drag STARTING inside and released on the backdrop is ignored', async () => {
    // THE defect this hook exists for. A `click` fires on the common ancestor
    // of press and release, which for this gesture is the mask — so antd's own
    // `maskClosable` would close the modal because the doctor highlighted a
    // dose to re-read it. The press ORIGIN is where the intent is.
    const onClose = vi.fn();
    render(<Harness dirty={false} onClose={onClose} />);
    const dose = screen.getByLabelText('Dose');
    const mask = backdrop();

    fireEvent.mouseDown(dose, { target: dose });
    fireEvent.mouseUp(mask, { target: mask });
    // And the click the browser then fires, on the shared ancestor.
    fireEvent.click(mask, { target: mask });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Dose')).toBeInTheDocument();
  });

  it('a press starting on the backdrop and released inside is also ignored', async () => {
    // The mirror case. Only a gesture that both starts AND ends outside is a
    // dismissal; anything else is a drag whose meaning is not "close this".
    const onClose = vi.fn();
    render(<Harness dirty={false} onClose={onClose} />);
    const mask = backdrop();
    const dose = screen.getByLabelText('Dose');

    fireEvent.mouseDown(mask, { target: mask });
    fireEvent.mouseUp(dose, { target: dose });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('nothing closes while a save is in flight', () => {
  it('Escape does nothing while loading', async () => {
    const onClose = vi.fn();
    render(
      <KuwickModal open title="Add medication" loading onClose={onClose}>
        <p>Saving</p>
      </KuwickModal>,
    );
    await userEvent.keyboard('{Escape}');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onClose).not.toHaveBeenCalled();
  });
});
