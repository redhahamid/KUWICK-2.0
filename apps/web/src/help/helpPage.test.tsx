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
});
