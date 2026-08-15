/**
 * G4.5d5b-1 — the shared premium clinical UX foundation.
 *
 * Small on purpose. Every component here solves behaviour that was already
 * being reimplemented, differently, in more than one place; nothing was added
 * for naming consistency alone.
 */
export { KuwickModal, DISCARD_TITLE, DISCARD_BODY } from './KuwickModal';
// b1 PHASE B — every later modal (profile slide-over, orders, documents)
// reuses this rather than re-deriving when a form may be abandoned.
export { useDismissableModal } from './useDismissableModal';
export type { DismissableModal } from './useDismissableModal';
export type { KuwickModalProps } from './KuwickModal';
export { KuwickConfirmModal } from './KuwickConfirmModal';
export type { KuwickConfirmModalProps } from './KuwickConfirmModal';
export { KuwickModalActionBar } from './KuwickModalActionBar';
export { KuwickFormSection } from './KuwickFormSection';
export { KuwickStatusTag } from './KuwickStatusTag';
export type { KuwickStatusTagProps } from './KuwickStatusTag';
export {
  KuwickSearchSelect,
  SEARCH_DEBOUNCE_MS,
  RESULT_CAP,
  REFINE_MESSAGE,
} from './KuwickSearchSelect';
export type { KuwickSearchOption } from './KuwickSearchSelect';
export { KuwickResultCard } from './KuwickResultCard';
export { KuwickCalculatorShell } from './KuwickCalculatorShell';
