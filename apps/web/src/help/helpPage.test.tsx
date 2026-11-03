// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { HelpPage } from './HelpPage';
import { Markdown } from './Markdown';

describe('help (testing, 15 October 2026)', () => {
  it('shows the staff guide in Bahasa Melayu first, and in English on request', () => {
    render(
      <MemoryRouter>
        <HelpPage guide="staff" />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { level: 1 }).textContent).toMatch(/panduan untuk staf/);
    fireEvent.click(screen.getByRole('button', { name: 'English' }));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toMatch(/guide for staff/);
  });

  it('keeps each step with what you see after it', () => {
    const { container } = render(<Markdown source={'## Leave\n\n1. Press **Submit request**.\n   You see "Sent".\n'} />);
    expect(container.querySelector('li b')?.textContent).toBe('Submit request');
    expect(container.querySelector('.kw-help__after')?.textContent).toBe('You see "Sent".');
  });

  /* Payroll A–Z guide, 3 November 2026. */
  it('shows a guide picture where the guide names one, at the address the app serves it from', () => {
    const { container } = render(
      <Markdown source={'### Step 1\n\n![The company step](img/payroll-a-z/a03-company.webp)\n\nFill in the numbers.\n'} imageUrl={(path) => `/assets/${path.split('/').pop()}`} />,
    );
    expect(container.querySelector('h3')?.textContent).toBe('Step 1');
    expect(container.querySelector('img')?.getAttribute('src')).toBe('/assets/a03-company.webp');
    expect(container.querySelector('img')?.getAttribute('alt')).toBe('The company step');
    expect(container.querySelector('p')?.textContent).toBe('Fill in the numbers.');
  });

  it('leaves out a picture the app does not have, rather than a broken image', () => {
    const { container } = render(<Markdown source={'![Missing](img/nowhere.webp)\n'} imageUrl={() => undefined} />);
    expect(container.querySelector('img')).toBeNull();
  });

  it('links the HR guide to Payroll A–Z', () => {
    render(
      <MemoryRouter>
        <HelpPage guide="hr" />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'English' }));
    expect(screen.getByRole('link', { name: 'Payroll A–Z (step by step)' }).getAttribute('href')).toBe('/admin/hr/help/payroll');
  });
});
