import { ReactNode } from 'react';
import { Drawer } from 'antd';
import { PersonAvatar } from './Person';

/**
 * THE RIGHT-HAND DETAIL DRAWER.
 *
 * The reference sheet is explicit that an employee's payroll detail is a
 * drawer and not an expanded row, and it is right for a reason worth writing
 * down: an expanded row pushes every other row down the screen, so the moment
 * you open one you lose the register you were reading it against. A drawer
 * keeps the register in place behind it, which is exactly the comparison
 * somebody checking one person's net pay is trying to make.
 *
 * ONE DRAWER SHELL, used by the payroll detail, the attendance day detail, the
 * leave request detail and the claim detail — identity header, scrolling
 * sections, and a sticky footer that carries the one number or the one action
 * that matters.
 */
export function DetailDrawer({
  open,
  onClose,
  name,
  subtitle,
  tags,
  width = 480,
  footer,
  children,
  loading,
}: {
  open: boolean;
  onClose: () => void;
  /** Whose record this is. Rendered with the same avatar as every other screen. */
  name: string;
  subtitle?: ReactNode;
  tags?: ReactNode;
  width?: number;
  /** Sticky. The net pay, or Approve/Reject. */
  footer?: ReactNode;
  children: ReactNode;
  loading?: boolean;
}) {
  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={width}
      className="kw-detailDrawer"
      closable={false}
      destroyOnClose
      title={
        <div className="kw-detailDrawer__head">
          <PersonAvatar name={name} size={38} />
          <div className="kw-detailDrawer__headText">
            <span className="kw-detailDrawer__name">{name}</span>
            {subtitle ? <span className="kw-detailDrawer__sub">{subtitle}</span> : null}
          </div>
          <button type="button" className="kw-detailDrawer__close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
      }
      footer={footer ? <div className="kw-detailDrawer__foot">{footer}</div> : null}
    >
      {tags ? <div className="kw-detailDrawer__tags">{tags}</div> : null}
      {loading ? <p className="kw-muted">Loading…</p> : children}
    </Drawer>
  );
}

/** A titled block inside the drawer, with an optional right-hand action. */
export function DrawerSection({
  title,
  action,
  children,
}: {
  title: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="kw-drawerSection">
      <header className="kw-drawerSection__head">
        <h4 className="kw-drawerSection__title">{title}</h4>
        {action ? <div>{action}</div> : null}
      </header>
      <div className="kw-drawerSection__body">{children}</div>
    </section>
  );
}

/**
 * A LINE ITEM: what it is on the left, what it is worth on the right, and —
 * where the number was not typed by a human — where it came from.
 *
 * `source` is the brief's provenance requirement, and it is load-bearing on
 * this screen above all others. "Overtime RM180.00" means one thing if
 * somebody entered it and another if it was computed from 12 approved hours;
 * only one of those is worth arguing with, and the reader cannot tell which
 * without being told.
 */
export function LineItem({
  label,
  value,
  source,
  tone,
  strong,
  action,
}: {
  label: ReactNode;
  value: ReactNode;
  source?: ReactNode;
  tone?: 'deduct' | 'muted';
  strong?: boolean;
  action?: ReactNode;
}) {
  return (
    <div className={`kw-lineItem${tone ? ` kw-lineItem--${tone}` : ''}${strong ? ' kw-lineItem--strong' : ''}`}>
      <div className="kw-lineItem__text">
        <span className="kw-lineItem__label">{label}</span>
        {source ? <span className="kw-lineItem__source">{source}</span> : null}
      </div>
      <span className="kw-lineItem__value">{value}</span>
      {action ? <span className="kw-lineItem__action">{action}</span> : null}
    </div>
  );
}

/** The subtotal that closes a drawer section. */
export function LineTotal({ label, value, tone }: { label: ReactNode; value: ReactNode; tone?: 'deduct' }) {
  return (
    <div className={`kw-lineTotal${tone ? ` kw-lineTotal--${tone}` : ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
