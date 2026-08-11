// @vitest-environment jsdom
import { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InlineVitalsRow } from './InlineVitalsRow';

// ===========================================================================
// KW2-C3 — the inline vitals row, in a DOM.
//
// What cannot be tested as a pure function: that typing a number actually
// records an OBSERVATION through the attributed endpoint, that a failed save
// leaves the doctor's numbers on screen, and that a signed visit gets no
// inputs at all.
// ===========================================================================

const { get, post } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('../core/api-client', () => ({
  ApiError: class extends Error {},
  apiClient: { get, post, patch: vi.fn(), delete: vi.fn() },
}));

function Harness({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const renderRow = (props: Partial<Parameters<typeof InlineVitalsRow>[0]> = {}) =>
  render(
    <Harness>
      <InlineVitalsRow visitId="visit-1" {...props} />
    </Harness>,
  );

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  get.mockResolvedValue([]);
  post.mockResolvedValue({ id: 'obs-1' });
});

describe('the strip is where vitals are entered', () => {
  it('every one of the six has a real input', async () => {
    renderRow();
    for (const label of ['BP', 'PR', 'Temp', 'SpO₂', 'Wt', 'Ht']) {
      expect(await screen.findByLabelText(label)).toBeEnabled();
    }
    // Blood pressure is one reading in two boxes.
    expect(screen.getByLabelText('BP diastolic')).toBeInTheDocument();
  });

  it('BMI is derived — it has no input at all', async () => {
    renderRow();
    const bmi = await screen.findByTestId('inline-bmi');
    expect(bmi.querySelector('input')).toBeNull();
    expect(bmi).toHaveTextContent('—');
  });

  it('typing weight and height fills the BMI live, before any save', async () => {
    renderRow();
    await userEvent.type(await screen.findByLabelText('Wt'), '70');
    expect(await screen.findByTestId('inline-bmi')).toHaveTextContent('—');
    await userEvent.type(screen.getByLabelText('Ht'), '170');
    await waitFor(() => expect(screen.getByTestId('inline-bmi')).toHaveTextContent('24.2'));
  });
});

describe('what a typed value actually does', () => {
  it('records an OBSERVATION through the attributed endpoint', async () => {
    // Recording a vital is a clinical act with an author and a time. Typing
    // it in a smaller box does not make it less of one.
    renderRow();
    const pulse = await screen.findByLabelText('PR');
    await userEvent.type(pulse, '82');
    await userEvent.tab();

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post.mock.calls[0][0]).toBe('/visits/visit-1/observations');
    expect(post.mock.calls[0][1]).toEqual({ pulse: 82 });
  });

  it('sends only what was filled in — never a null over another field', async () => {
    renderRow();
    await userEvent.type(await screen.findByLabelText('Temp'), '37.4');
    await userEvent.tab();
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0][1]).toEqual({ temperature: 37.4 });
  });

  it('an empty strip records nothing, however often it is blurred', async () => {
    renderRow();
    const pulse = await screen.findByLabelText('PR');
    await userEvent.click(pulse);
    await userEvent.tab();
    await userEvent.click(pulse);
    await userEvent.tab();
    expect(post).not.toHaveBeenCalled();
  });

  it('blurring twice with the same numbers records ONE reading', async () => {
    // A second write would be a second observation row describing a reading
    // nobody took.
    renderRow();
    const pulse = await screen.findByLabelText('PR');
    await userEvent.type(pulse, '82');
    await userEvent.tab();
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));

    await userEvent.click(pulse);
    await userEvent.tab();
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('a failed save says so and LEAVES the numbers on screen', async () => {
    // The doctor has already taken this reading off the patient. A strip that
    // clears itself loses it.
    post.mockRejectedValue(new Error('offline'));
    renderRow();
    const pulse = await screen.findByLabelText('PR');
    await userEvent.type(pulse, '82');
    await userEvent.tab();

    await waitFor(() => expect(post).toHaveBeenCalled());
    expect((pulse as HTMLInputElement).value).toBe('82');
  });
});

describe('a visit that is closed', () => {
  it('gets no inputs at all', () => {
    renderRow({ readOnly: true });
    expect(screen.queryByTestId('inline-vitals')).not.toBeInTheDocument();
  });
});

describe('the full panel stays reachable', () => {
  it('for the observations the strip does not own', async () => {
    const onOpenFull = vi.fn();
    renderRow({ onOpenFull });
    await userEvent.click(await screen.findByRole('button', { name: /More/ }));
    expect(onOpenFull).toHaveBeenCalledTimes(1);
  });
});
