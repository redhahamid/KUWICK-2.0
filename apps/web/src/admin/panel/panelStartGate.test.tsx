// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import workspaceSource from './PanelWorkspacePage.tsx?raw';
import { PanelStartGate } from './PanelStartGate';

describe('the empty Panel module', () => {
  it('offers the way in rather than an empty workspace', () => {
    render(
      <MemoryRouter>
        <PanelStartGate />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: /Set up your panels/ }).getAttribute('href')).toBe(
      '/admin/panel/setup',
    );
    // A clinic may want to bring in its old claim listing before setting up a
    // single panel, so that door is on this screen too.
    expect(screen.getByRole('link', { name: /old claims/ }).getAttribute('href')).toBe(
      '/admin/panel/import',
    );
  });

  /**
   * THE GATE READS THE SERVER'S ANSWER, NOT AN EMPTY TABLE.
   *
   * `needsSetup` is computed from the clinic's own panels. Gating on
   * `queue.data?.length === 0` instead would turn a failed request into "you
   * have no panels" and send somebody into a wizard that then refuses every
   * name as a duplicate — and it would show the gate to a clinic whose panels
   * are all set up and simply have nothing to submit today, which is the
   * normal state of a quiet morning.
   */
  it('is gated on needsSetup, never on the tables being empty', () => {
    expect(workspaceSource).toContain('setup.data?.needsSetup');
    expect(workspaceSource).toContain('<PanelStartGate />');
    expect(workspaceSource).not.toMatch(/needsSetup.*(queue|work|reconciliation)\.data/);
  });
});
