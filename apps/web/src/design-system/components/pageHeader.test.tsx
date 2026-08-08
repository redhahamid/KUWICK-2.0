// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import { Button } from 'antd';
import { describe, expect, it } from 'vitest';
import { PageHeader } from './PageHeader';

// ===========================================================================
// G4.5d6 — THE PAGE HEADER, AND THE iPHONE TITLE THAT WRAPPED VERTICALLY
//
// jsdom has no layout engine, so these cannot measure pixels. What they CAN
// pin is the structure the CSS depends on: a heading block that is allowed to
// keep its width, and an actions block that is allowed to move. If a future
// change puts the actions back inside the heading, the CSS stops working and
// these tests are the thing that says so.
// ===========================================================================

describe('structure the responsive CSS relies on', () => {
  it('1. the title and the actions are SIBLINGS, not nested', () => {
    // The old idiom nested both inside one antd Space, whose items do not
    // shrink evenly — the buttons held their width and the heading was
    // crushed to 22px, one letter per line.
    const { container } = render(
      <PageHeader title="Appointments" extra={<Button>Book Appointment</Button>} />,
    );
    const heading = container.querySelector('.kw-page-header-heading')!;
    const actions = container.querySelector('.kw-page-header-actions')!;
    expect(heading).toBeInTheDocument();
    expect(actions).toBeInTheDocument();
    expect(heading.contains(actions)).toBe(false);
    expect(actions.contains(heading)).toBe(false);
    expect(heading.parentElement).toBe(actions.parentElement);
  });

  it('2. the heading carries the class that reserves its width', () => {
    const { container } = render(<PageHeader title="Patients" />);
    expect(container.querySelector('.kw-page-header-heading')).toBeInTheDocument();
    expect(container.querySelector('.kw-page-title')).toBeInTheDocument();
  });

  it('3. renders a real heading element, so the page keeps its outline', () => {
    render(<PageHeader title="Staff" />);
    expect(screen.getByRole('heading', { name: 'Staff' })).toBeInTheDocument();
  });

  it('4. a page with no actions renders no empty actions box', () => {
    const { container } = render(<PageHeader title="Rooms" />);
    expect(container.querySelector('.kw-page-header-actions')).toBeNull();
  });
});

describe('what it shows', () => {
  it('5. keeps every action it is given', () => {
    const { container } = render(
      <PageHeader
        title="Appointments"
        extra={
          <>
            <Button>Calendar view</Button>
            <Button type="primary">Book Appointment</Button>
          </>
        }
      />,
    );
    const actions = container.querySelector('.kw-page-header-actions')!;
    expect(within(actions as HTMLElement).getByRole('button', { name: 'Calendar view' })).toBeInTheDocument();
    expect(
      within(actions as HTMLElement).getByRole('button', { name: 'Book Appointment' }),
    ).toBeInTheDocument();
  });

  it('6. a subtitle sits on its own row rather than beside the title', () => {
    // On a phone a subtitle competing for the title's row is the same fault
    // in a different costume.
    const { container } = render(
      <PageHeader title="Document Templates" subtitle="Active templates appear in Documents." />,
    );
    const subtitle = container.querySelector('.kw-page-header-subtitle')!;
    expect(subtitle).toHaveTextContent('Active templates appear in Documents.');
    expect(container.querySelector('.kw-page-header-heading')!.contains(subtitle)).toBe(false);
  });

  it('7. a badge stays WITH the title — it qualifies the heading', () => {
    const { container } = render(<PageHeader title="Queue" badge={<span>Live</span>} />);
    const heading = container.querySelector('.kw-page-header-heading')!;
    expect(within(heading as HTMLElement).getByText('Live')).toBeInTheDocument();
  });
});
