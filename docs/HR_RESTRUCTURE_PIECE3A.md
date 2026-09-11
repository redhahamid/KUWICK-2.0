# HR restructure — Piece 3a: the Slate kit and the HR shell

The kit in `docs/design/hr-slate/kit.css`, expressed as Kuwick custom
properties and scoped so it cannot reach anything else; a slate shell for HR;
nine shared components; and one screen — the Settings landing — on all of it.
No Prisma schema change. No feature. Operation, Stock, Panel and Finance are
untouched, and a guard fails the build if that stops being true.

## 1. Tokens: scoped, not global

`design-system/tokens.ts` is the one source for the whole product. It feeds
antd's theme and generates the `--kw-*` properties in `index.css`, and its
palette is navy. Slate is a different palette. Repainting the tokens would
have repainted the other four modules along with HR.

So the Slate values live in `apps/web/src/admin/hr/ui/slate.css` as `--hr-*`
properties declared under two class scopes and nowhere else:

| Scope | Where it goes | Why |
|---|---|---|
| `.kw-hrSlate` | the HR shell and everything inside it | the module itself |
| `.kw-hrSlateHeader` | the product header, on HR routes only | the header is a sibling of the shell, not a child, so the scope has to be put on it |

`tokens.ts` and `index.css` are not modified. antd inside HR follows the kit
through a `ConfigProvider` around the HR outlet — teal as the action colour,
the kit's radius — which is also scoped by construction.

`slateIsolation.test.tsx` holds five guards, each watched to fail before it
passed: the palette is declared only under the two scopes and never on
`:root`; no file outside `admin/hr/` references `--hr-` or imports the
stylesheet; none of Slate's seven hex values appears in `tokens.ts` or
`index.css`; every rule that touches the product header is scoped by class;
and the stylesheets were actually read from disk — Vite answers a `?raw`
import of a `.css` file with an empty string, which is how the first draft of
this file passed while proving nothing.

## 2. The shell

`AdminLayout` chooses: HR routes render `HrShell`, the other four render
`HubShell` exactly as before. Neither can change the other by accident.

**The header.** `AppLayout` draws one header for the whole product. On HR
routes it takes the `kw-hrSlateHeader` class, the breadcrumb reads
*Administration / HR*, and the five module tabs move up into it — Operation ·
Stock · Panel · HR · Finance, HR underlined in teal. The Slate mockups have no
second row, and crossing from HR to Finance without going back to a hub is a
thing every screen in the product promises, so the tabs moved rather than
went. Exactly one set of module tabs renders on any page: `HrShell` draws
none, `HubShell` draws its own for the other four, and `admin-shell.spec.ts`
asserts the tabs by role on every page unchanged.

**The sidebar.** `#1E3E37`, 232px, the module label in the kit's one
permitted all-caps, an icon on every entry, and a gold count on Payroll, Leave
and Claims when a person is waiting for a decision — rows that would hold up
approval this month, leave requests, claims. The counts come from
`useWorkforceToday` and `usePayrollReadiness`, which already answered those
questions for the Today screen; no new endpoint. Settings sits at the foot,
apart, behind a hairline.

The rail entries keep their existing class names (`kw-hubRail__item`,
`is-active`, `kw-hubRail__heading`) on purpose: they are the contract a dozen
browser assertions use for "the rail lights the section you are standing in",
and renaming them would have meant rewriting those assertions to prove the
same thing about the same element. The label sits in its own element so a
test can read the section's name without the count beside it.

**One thing the mockups do not have.** A branch picker, under the module
label. A group-level person — the finance controller who covers both
branches — has no home clinic, and every branch-scoped screen answers with
zeros until they choose one. The mockups are drawn for a single branch. The
picker stays.

## 3. Components, in `apps/web/src/admin/hr/ui/`

| Component | Replaces | Note |
|---|---|---|
| `StatusChip` | `admin/components/Chip.tsx` | five tones: done · attn · block · muted · info |
| `Panel`, `PanelHead` | `admin/components/Panel.tsx` | |
| `Steps` | `StageBar.tsx` | a step is done when finished, never "done because a later one is open" |
| `Toolbar`, `ToolbarSearch` | `FilterBar.tsx` | |
| `SegControl` | `WorkAreaTabs.tsx` | same page, different cut — not navigation |
| `Drawer` | `DetailDrawer.tsx` | starts below the header; Escape closes it |
| `IconButton` | — | new |
| `StatCard`, `StatRow` | `StatStrip.tsx` | **forked**: 20 screens outside HR use `StatStrip` |
| `HrPage` | `AdminShell.tsx` | **forked**: 23 screens outside HR use `AdminShell` |
| `icons.tsx` | — | every path traced from the mockups; no icon library, because a pack's nearest glyph is a different stroke at a different optical size |

The old HR-only components are not deleted yet. They are used by the HR
screens that have not moved — Payroll, Employees, Attendance, Leave, Claims,
Reports — and swapping a chip on a screen that is otherwise still navy would
give it two kits at once. Each old component goes when its last screen moves,
in 3b–3f. `DataTable` is not forked in this piece; the Settings landing has no
table.

## 4. The Settings landing

`settings.html`, on the kit. The progress ring is a conic gradient of done
over required; "One to go" names the outstanding thing beside it. Five
required rows and one optional, each required row with Open; six cards with
their icons, a status chip, and when the thing was last changed.

Two fields the cards wanted were in Prisma and not in the DTO. `LegalEmployer`
and `PayComponent` both carry `updatedAt`; neither `LegalEmployerRow` nor
`PayComponentRow` exposed it. They do now — a DTO change, not a schema change.
"Started Jan 2026" on Opening balances is the month of the first payroll run
that was not cancelled; when there is none it is blank rather than a guess.

## 5. Where the result differs from the mockup, and why

| On the mockup | On the result | Why |
|---|---|---|
| Header: logo, crumbs, clinic, name, avatar | also the five module tabs, Back, and the bell | the module tabs by decision; Back and the bell belong to the product header and are not HR's to remove |
| No branch picker | picker under the module label | §2, last paragraph |
| Bank payment file has a **Set up** button | no button | there is nothing to set up: no bank format is on record. Piece 2's decision, kept |
| "Changed 14 Aug" on Payroll policies and Attendance & leave | blank | `PayrollPolicy.updatedAt` and `AttendancePolicy.updatedAt` exist in Prisma but those endpoints return a derived shape, not the row. Exposed in 3b with the pages themselves |
| "checked … on 3 Sep 2026" | no date | `verifiedAt` is null in the UAT tenant; the code renders it when set |
| Attendance & leave: "…annual and sick leave entitlement by years of service" | "…what counts as overtime" | there is no leave-policy screen; the card promises what the page delivers |
| Payroll **2**, "**1** number missing", "EPF employer number" | 4, 2, "SOCSO, LHDN" | data — the UAT tenant's own figures |
| Inter / Inter Tight | Chromium's fallback sans | this container's proxy resets the Google Fonts request; see the screenshot README |

## 6. Copy

Sentence case throughout. No arrows in link text — the cards no longer say
"Open →". No all-caps except the sidebar module label, which the kit itself
sets in uppercase at 11px with letter-spacing; the prompt and the kit disagree
there and the kit wins on visuals. No "snapshot", "journey" or
"materialisation" on the screen.

## 7. Not in this piece

Every other HR screen. The per-row switches on Payroll items. `DataTable`.
Deleting the old HR components. Leave policies.
