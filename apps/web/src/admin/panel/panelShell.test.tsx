// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import layoutSource from '../AdminLayout.tsx?raw';
import appLayoutSource from '../../design-system/components/AppLayout.tsx?raw';

/**
 * PANEL IS A WORKSPACE, AND IT LOOKS LIKE ONE.
 *
 * The owner's instruction of 3 November 2026 was that Panel wear the same
 * premium surface as HR. The risk in doing that is not the colours — it is
 * everything that was written once for HR and would stay written for HR:
 * the shell chosen per route, the header crumb, the lit module tab. Each of
 * those was literally `startsWith('/admin/hr')`, so Panel would have rendered
 * in the hub chrome, or worse, in the Slate chrome under the words
 * "Administration / HR".
 */
vi.mock('../hooks/useAdmin', () => ({
  usePanelWorkQueue: () => ({ data: [{ id: 'c1' }, { id: 'c2' }], isLoading: false }),
  usePanelConfigs: () => ({
    data: [
      // Needs an answer: a fee nobody has established.
      { id: 'p1', active: true, feeTreatmentUnresolved: true, paymentTermDays: 30, paymentTermVariesByPayer: false },
      // Needs an answer: no term, so no claim on it can ever read as overdue.
      { id: 'p2', active: true, feeTreatmentUnresolved: false, paymentTermDays: null, paymentTermVariesByPayer: false },
      // Settled, and so not counted.
      { id: 'p3', active: true, feeTreatmentUnresolved: false, paymentTermDays: 60, paymentTermVariesByPayer: false },
      // Inactive, and so not counted however unresolved it is.
      { id: 'p4', active: false, feeTreatmentUnresolved: true, paymentTermDays: null, paymentTermVariesByPayer: false },
    ],
    isLoading: false,
  }),
}));

vi.mock('../../core/hooks/useClinicFilter', () => ({
  useClinicFilter: () => ({ clinicId: undefined, setClinicId: vi.fn(), clinics: [], showSelector: false }),
}));

vi.mock('../../core/hooks/useCan', () => ({ useCanCheck: () => () => true }));

const { PanelShell } = await import('./PanelShell');

const at = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <PanelShell />
    </MemoryRouter>,
  );

describe('the Panel shell', () => {
  it('draws the panel sections, not HR&rsquo;s', () => {
    at('/admin/panel');
    const rail = screen.getByRole('navigation', { name: 'Panel sections' });
    expect(rail).toBeTruthy();
    for (const label of ['Claim workspace', 'Import claims', 'Panel configuration']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });

  it('wears the Slate surface', () => {
    const { container } = at('/admin/panel');
    expect(container.querySelector('.kw-hrSlate')).not.toBeNull();
    // And the hub's normalisation as well, so the Panel screens that have NOT
    // moved to the kit keep the look they have today rather than losing it by
    // omission the moment this shell took over.
    expect(container.querySelector('.kw-hub--admin')).not.toBeNull();
  });

  /**
   * The bug this would have been: a claim opened at `/admin/panel/claims/:id`
   * lights nothing, and the rail reads as "you are nowhere".
   */
  it('lights the section that owns the route, including a deeper URL', () => {
    at('/admin/panel/configuration');
    expect(screen.getByRole('button', { current: 'page' }).textContent).toContain('Panel configuration');

    at('/admin/panel/import/anything/deeper');
    const lit = screen.getAllByRole('button', { current: 'page' });
    expect(lit[lit.length - 1].textContent).toContain('Import claims');
  });

  /**
   * A count in the rail means somebody is waiting. Two seats only, and both are
   * money needing a decision — an unresolved fee or a missing term is why a
   * panel's figures cannot be relied on.
   */
  it('counts only what waits on a person, ignoring inactive panels', () => {
    at('/admin/panel');
    const configure = screen
      .getAllByRole('button')
      .find((button) => button.textContent?.includes('Panel configuration'));
    expect(configure?.textContent).toContain('2');

    const queue = screen
      .getAllByRole('button')
      .find((button) => button.textContent?.includes('Claim workspace'));
    expect(queue?.textContent).toContain('2');

    // Nothing waits on a decision in Batches, so it carries no number.
    const batches = screen
      .getAllByRole('button')
      .find((button) => button.textContent?.includes('Claim batches'));
    expect(batches?.textContent?.replace('Claim batches', '')).not.toMatch(/\d/);
  });
});

describe('the chrome around it', () => {
  it('routes /admin/panel to the Panel shell rather than the hub', () => {
    expect(layoutSource).toContain("startsWith('/admin/panel')");
    expect(layoutSource).toContain('<PanelShell />');
  });

  /**
   * The header is a sibling of the shell, not a child, so it cannot inherit
   * the surface — it takes the class. All three of these were HR-only.
   */
  it('gives the app header the Slate class, the right crumb and the right tab on panel routes', () => {
    expect(appLayoutSource).toContain("startsWith('/admin/panel')");
    // No `inAdminHr` survives: each of its three uses is now module-aware.
    expect(appLayoutSource).not.toMatch(/\binAdminHr\b/);
    expect(appLayoutSource).toContain("activeKey={slateModule}");
    expect(appLayoutSource).toContain("slateModule === 'hr' ? 'HR' : 'Panel'");
  });
});
