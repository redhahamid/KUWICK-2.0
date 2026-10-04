# Kuwick 2.0 — UI Design System

**Status:** Initial design system for Phase 0. No clinical screens are built yet — this establishes the tokens, components, and layout rules every future screen must follow, so Phase 1 modules look and behave as one product rather than seven separately-designed tools.

**Important constraint carried from `PRODUCT_REQUIREMENTS.md` §19**: no screen, layout, or interaction pattern may be copied from the audited reference systems (existing Kuwick, Yezza, the management reference system). This design system is original.

## 1. Foundation

- **Component kit**: Ant Design v5, themed via its design-token API rather than overriding CSS — keeps upgrades safe and keeps every component (table, form, modal, date picker) visually consistent for free.
- **Density**: "compact" Ant Design theme algorithm by default. This is a data-entry-heavy clinic system (patient tables, stock lists, claim batches) — density beats whitespace here.
- **Typography**: system font stack (`-apple-system, "Segoe UI", Roboto, sans-serif`) rather than a licensed webfont — no brand typography has been supplied, and a system stack renders instantly with no flash-of-unstyled-text.

## 2. Color

- **Placeholder brand palette** — no brand colors have been supplied yet. Using Ant Design's default blue (`#1677ff`) as the primary/action color until real brand colors are provided; swapping this later is a single theme-token change, not a rewrite.
- **Semantic status colors** (not brand — these encode meaning and must stay consistent everywhere a status appears):

| Meaning | Color | Used for |
|---|---|---|
| Success / completed / paid | Green | Completed visit, Fully Received PO, Paid claim |
| In progress / active | Blue | Confirmed appointment, In Consultation, Submitted claim |
| Attention / waiting | Gold/Amber | Waiting in queue, Requested appointment, Pending approval |
| Warning / needs action | Orange | Low stock, Partially received, Partial settlement |
| Error / rejected / stopped | Red | Cancelled, No-Show, Rejected claim, Below-minimum stock |
| Neutral / inactive | Gray | Draft, Closed, Archived |

Every status lifecycle in `PRODUCT_REQUIREMENTS.md` §7 maps to exactly one of these six — a new status introduced later must be assigned one of these meanings, not a new ad hoc color.

- **Accessibility**: all text/background pairings meet WCAG 2.1 AA contrast (4.5:1 body text, 3:1 large text/icons). Status is never color-only — every status badge pairs color with a text label or icon, since color-blind clinic staff must be able to read a queue board correctly.

## 3. Spacing & layout

- 4px base unit; spacing scale of 4/8/12/16/24/32/48px. Ant Design's default spacing tokens are used as-is rather than a custom scale, to avoid fighting the component kit's own internal spacing.
- **Desktop-first grid** for front-desk, clinical, and back-office screens (per `PRODUCT_REQUIREMENTS.md` §13): a persistent left sidebar for module navigation, top bar for branch selector + user menu + notifications, content area using Ant Design's `Table`/`Form`/`Descriptions` for dense data.
- **Mobile/tablet layouts** (doctor schedule review, queue monitor display, patient booking portal) collapse the sidebar into a bottom tab bar or hamburger menu and stack content into single-column cards — same components, same tokens, different arrangement. No feature is rebuilt separately for mobile; it's the same screen re-flowed, per spec.
- Breakpoints: `mobile <768px`, `tablet 768–1199px`, `desktop ≥1200px` (Ant Design's default grid breakpoints, unmodified).

## 4. Navigation & role-awareness

The left-sidebar module list is generated from the same permission matrix that drives RBAC (`PRODUCT_REQUIREMENTS.md` §5) — a role never sees a module link it has no access to, rather than seeing it and hitting a permission error after clicking. This is a single source of truth shared with the backend guard, not a duplicated frontend copy.

## 5. Core interaction patterns

- **Status badges**: every lifecycle entity (Appointment, Queue, Procurement, Panel Claim) renders its status as a colored badge using the mapping in §2 — implemented once as a shared `<StatusBadge status={} type={} />` component, not re-implemented per module.
- **Tables**: server-side pagination, sorting, and filtering by default (not client-side) — clinic data volume (patients, stock movements, claims) will outgrow client-side table logic quickly.
- **Forms**: validation errors shown inline, next to the field, not only in a summary banner — critical for clinical data entry where a missed required field (e.g., allergy) has real consequences.
- **Drill-down charts** (Reports & Analytics executive dashboard): every chart is clickable through to the filtered transaction list behind it, consistent with `PRODUCT_REQUIREMENTS.md` §12 — a bar in "revenue by branch" opens that branch's transaction table pre-filtered, not a dead-end static image.
- **Empty/loading/error states**: every data view defines all three explicitly (Ant Design `Skeleton`/`Empty`/`Result` components) — no screen silently shows a blank table with no explanation.

## 6. Iconography

Ant Design's built-in icon set (`@ant-design/icons`) — no separate icon library, to avoid inconsistent stroke widths/visual weight against the component kit.

## 7. What's built during initialization vs. later

**Built now** (`packages/design-system` — see folder structure): theme token file (colors, spacing, typography), the `<StatusBadge>` shared component, and a themed Ant Design `ConfigProvider` wrapper. This is enough to render a consistent placeholder shell.

**Not built now**: any clinical, appointment, HR, inventory, panel-claims, or reports screen. Those arrive with their respective Phase 1 module, built using the tokens and patterns established here.

## 8. The canvas palette (October 2026)

The clinical canvas design the owner approved in October 2026 — a white top
bar with the KUWICK wordmark, pill navigation with a soft indigo active state,
a grey-lavender page, white cards with 18px corners and a soft shadow, a
gradient icon tile beside every card title, indigo primary buttons and soft
tinted status chips — is declared once:

- `apps/web/src/design-system/tokens.ts` — `canvas` (surfaces, ink, indigo,
  the four status pairs, radii, the card shadow, the bar height) and
  `tileGradients` (one gradient per card family: indigo, rose, amber, violet,
  teal, sky, green, slate, blue).
- `apps/web/src/index.css` — the same values as `--kw-c-*` custom properties,
  the white top bar (`.kw-app-header-canvas`), the tile (`.kw-tile`) and the
  canvas's antd overrides.

Three areas read it and nothing else restates it: the clinical canvas
(`clinical/canvas/canvas.css`, whose `--kw2-*` names now point at `--kw-c-*`),
the HR module and the My Kuwick portal (`admin/hr/ui/slate.css`, whose `--hr-*`
names do the same). `design-system/components/IconTile.tsx` renders the tile;
HR panels inherit their section's tile through `SectionTileContext` and may
name their own. The product-wide antd primary (`colors.primary`, navy) is
deliberately untouched: the modules outside those three areas keep the colours
they were reviewed in, and moving them is one line in `theme.ts`.
