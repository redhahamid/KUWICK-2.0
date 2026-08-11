import { ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Modal, Typography } from 'antd';
import { ModalSize, modalWidths } from '../tokens';
import { KuwickConfirmModal } from './KuwickConfirmModal';

const { Text } = Typography;

/**
 * G4.5d5b-1 — THE modal.
 *
 * The audit counted roughly twenty modals and eighteen drawers across the
 * application, at eleven different widths, with focus restoration implemented
 * on exactly two of them. That is not twenty design decisions; it is one
 * decision nobody made, taken twenty times. This component makes it once.
 *
 * What it guarantees, and why each one is here rather than left to call sites:
 *
 *   FOCUS TRAP + RESTORATION. antd traps focus but restores it only while the
 *   trigger is still mounted — and a trigger very often disappears as a result
 *   of the action just confirmed. The trigger element is captured on open and
 *   focused explicitly on close, falling back to the caller's own target.
 *
 *   UNSAVED-CHANGE PROTECTION. A modal holding typed clinical data must not
 *   close because someone clicked the backdrop or pressed Escape. When
 *   `dirty` is set, both routes ask first, and the backdrop stops closing
 *   entirely. There is no configuration that lets typed data vanish silently.
 *
 *   ONE LEVEL. The confirmation is rendered by THIS component, above its own
 *   content, rather than as a second antd Modal stacked on the first: nested
 *   modal-on-modal is what makes focus order and Escape handling ambiguous.
 *
 *   MOBILE IS A SHEET, NOT A SHRUNKEN DIALOG. Below the mobile breakpoint the
 *   modal fills the screen with a sticky header and a sticky action footer, so
 *   the confirm button cannot end up behind the keyboard — which is the single
 *   most common way a phone user gets stuck in a form.
 *
 * The footer is deliberately NOT a prop pair (okText/onOk). Real clinical
 * modals have two, three or four actions with different tones, so the caller
 * passes a `footer` node — usually a KuwickModalActionBar.
 */

export interface KuwickModalProps {
  open: boolean;
  title: ReactNode;
  /** One short line under the title. Context, never instructions. */
  subtitle?: ReactNode;
  size?: ModalSize;
  children: ReactNode;
  /** Usually a KuwickModalActionBar. Sticky on mobile. */
  footer?: ReactNode;
  /**
   * True while the modal holds data the user typed and has not saved. Turns
   * the backdrop inert and puts a confirmation in front of Escape and Close.
   */
  dirty?: boolean;
  /** Blocks the content and the footer while a submission is in flight. */
  loading?: boolean;
  /**
   * A server error, shown ABOVE the content and inside the modal — never as a
   * toast that disappears while the user is still reading the form it refers
   * to.
   */
  error?: string | null;
  onClose: () => void;
  /** Focused after close when the original trigger has gone. */
  restoreFocusTo?: () => HTMLElement | null;
  /** Test/marker hook. */
  dataTestId?: string;
}

export const DISCARD_TITLE = 'Discard your changes?';
export const DISCARD_BODY =
  'You have entered information that has not been saved. Closing now will discard it.';

export function KuwickModal({
  open,
  title,
  subtitle,
  size = 'medium',
  children,
  footer,
  dirty = false,
  loading = false,
  error = null,
  onClose,
  restoreFocusTo,
  dataTestId,
}: KuwickModalProps) {
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const triggerRef = useRef<HTMLElement | null>(null);

  // Captured on OPEN, not on click: the caller does not have to remember to
  // pass its own trigger, and a modal opened from a keyboard shortcut still
  // restores somewhere sensible.
  useEffect(() => {
    if (open) {
      triggerRef.current = (document.activeElement as HTMLElement) ?? null;
    }
  }, [open]);

  const restoreFocus = useCallback(() => {
    const fallback = restoreFocusTo?.() ?? null;
    const target = fallback ?? triggerRef.current;
    // Only if it is still in the document — focusing a detached node throws
    // focus to <body> and loses the user's place entirely.
    if (target && document.contains(target)) {
      target.focus();
    }
  }, [restoreFocusTo]);

  /** Every close route funnels through here, so none of them can skip the guard. */
  const requestClose = useCallback(() => {
    if (loading) return;
    if (dirty) {
      setConfirmingDiscard(true);
      return;
    }
    onClose();
  }, [dirty, loading, onClose]);

  // Background scroll lock. antd does this for the body, but a nested
  // scrollable workspace pane behind the overlay keeps scrolling under the
  // user's finger on a phone, which reads as the modal being broken.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.body.classList.add('kw-modal-open');
    return () => {
      document.body.style.overflow = previous;
      document.body.classList.remove('kw-modal-open');
    };
  }, [open]);

  return (
    <>
      <Modal
        open={open}
        title={
          <div className="kw-modal-head">
            <div className="kw-modal-title">{title}</div>
            {subtitle && (
              <Text type="secondary" className="kw-modal-subtitle">
                {subtitle}
              </Text>
            )}
          </div>
        }
        width={modalWidths[size]}
        rootClassName={`kw-modal kw-modal-${size}`}
        // A dirty modal's backdrop does nothing at all. Asking "are you sure"
        // after an accidental backdrop click is better than losing the data,
        // but not clicking it away by accident is better still.
        maskClosable={!dirty && !loading}
        keyboard={false}
        closable={!loading}
        onCancel={requestClose}
        footer={footer ? <div className="kw-modal-footer">{footer}</div> : null}
        afterClose={restoreFocus}
        destroyOnHidden
        data-testid={dataTestId}
      >
        {/* Escape and the focus trap are BOTH implemented here rather than
            left to the library: antd's own trap does not hold in every
            rendering path, and a clinical modal that lets Tab walk out into
            the page behind is one where a keyboard user edits the record
            they thought they had covered up. Measured, not assumed — the
            foundation spec tabs eight times and checks every one. */}
        <EscapeHandler active={open} onEscape={requestClose} />
        <FocusTrap active={open} />
        {error && (
          <Alert
            type="error"
            showIcon
            role="alert"
            className="kw-modal-error"
            message={error}
            style={{ marginBottom: 12 }}
          />
        )}
        <div className="kw-modal-body" aria-busy={loading || undefined}>
          {children}
        </div>
      </Modal>

      {/* Rendered as a sibling, not nested inside the modal above: a modal
          stacked on a modal makes focus order and Escape ambiguous. */}
      <KuwickConfirmModal
        open={confirmingDiscard}
        title={DISCARD_TITLE}
        body={DISCARD_BODY}
        confirmLabel="Discard changes"
        cancelLabel="Keep editing"
        tone="danger"
        onCancel={() => setConfirmingDiscard(false)}
        onConfirm={() => {
          setConfirmingDiscard(false);
          onClose();
        }}
      />
    </>
  );
}

/**
 * Keeps Tab inside the dialog, wrapping at both ends.
 *
 * Deliberately re-queries the focusable set on every Tab rather than caching
 * it: a clinical modal's controls appear and disappear as it is filled in
 * (a correction reason, an acknowledgement checkbox), and a cached list traps
 * focus against elements that are no longer there.
 */
function FocusTrap({ active }: { active: boolean }) {
  useEffect(() => {
    if (!active) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      // By ROLE, not by an antd class name: the library renames its internal
      // nodes between versions, and a trap that silently stops matching is a
      // trap that silently stops trapping. The LAST dialog is the topmost —
      // when the discard confirmation is up, focus belongs to that one.
      const dialogs = document.querySelectorAll<HTMLElement>('[role="dialog"]');
      const dialog = dialogs[dialogs.length - 1] ?? null;
      if (!dialog) return;
      // The selector alone decides what is focusable. A visibility filter
      // based on `offsetParent` or `getClientRects` looks right and is a trap:
      // both are always empty under jsdom, so the filter would remove every
      // candidate and the trap would silently do nothing in exactly the
      // environment its test runs in.
      const focusable = [
        ...dialog.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ].filter((node) => node.getAttribute('aria-hidden') !== 'true');
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const current = document.activeElement as HTMLElement | null;

      // Anything outside the dialog — including the trigger behind it — is
      // pulled straight back in.
      if (!current || !dialog.contains(current)) {
        event.preventDefault();
        first.focus();
        return;
      }
      if (event.shiftKey && current === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && current === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [active]);
  return null;
}

/** Escape, routed through the caller's guard rather than antd's own handler. */
function EscapeHandler({ active, onEscape }: { active: boolean; onEscape: () => void }) {
  useEffect(() => {
    if (!active) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onEscape();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [active, onEscape]);
  return null;
}
