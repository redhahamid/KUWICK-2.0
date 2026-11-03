import { PanelType } from '@prisma/client';

/**
 * THE PLATFORM'S STARTER LIST OF PANELS.
 *
 * `DefaultPanelClinic` has existed since the first core migration, is editable
 * from the platform console, and is copied into every new tenant at
 * provisioning. It has also always been EMPTY, so every clinic Kuwick has ever
 * provisioned started with zero panels and typed its own list by hand — on a
 * screen that offers no suggestions. This file is the content that table was
 * built to hold.
 *
 * FOUR RULES ABOUT WHAT IS IN HERE, each of them about not asserting something
 * Kuwick cannot know.
 *
 *  1. NAMES AND KINDS ONLY. These are the bodies Malaysian clinics commonly
 *     panel with, classified as administrator or insurer. Inclusion asserts
 *     NOTHING about a commercial relationship — not the platform's, not any
 *     clinic's. It is a list to tick, and a clinic that panels with none of
 *     them deletes the lot and adds its own.
 *
 *  2. NO PORTAL URLS. A portal address is the thing staff actually click, and a
 *     wrong one sends a claim to the wrong place or simply wastes the morning.
 *     These change without notice and Kuwick cannot verify them from here, so
 *     every row ships with no URL and the clinic fills in the one it uses. An
 *     empty portal is already reported on the configuration screen, so the gap
 *     chases itself.
 *
 *  3. NO TERMS, NO FEES, NO LIMITS. Those are contract facts, they differ per
 *     clinic for the same panel, and a seeded 30-day term would be a guess
 *     wearing the authority of a default. The setup wizard asks; until it is
 *     answered the panel carries NULL and `UNCONFIGURED`, which every screen
 *     already knows how to report.
 *
 *  4. NO CORPORATE PANELS. A corporate panel is one employer billed directly,
 *     and every clinic's are its own — there is no national list to seed. They
 *     are added at the counter (N-5) or in the wizard's "add your own" step.
 *
 * NEVER "KUWICK". No row here, and nothing Kuwick writes into a panel's own
 * portal, carries the product's name as data. Demo and UAT tenants use the
 * neutral labels in `DEMO_PANELS` below.
 *
 * THE OPERATOR OWNS THIS LIST. It is a starting point curated from the
 * platform console, not a fact table — which is why the seed never deletes and
 * never overwrites a row somebody has edited. See `prisma/seed-default-panels.ts`.
 */
export interface DefaultPanelSeedRow {
  name: string;
  panelType: PanelType;
}

export const SEED_DEFAULT_PANELS: readonly DefaultPanelSeedRow[] = [
  // Third-party administrators — they administer a scheme somebody else
  // carries, so on these the payer is usually a different company again and
  // the payment term can be set by the employer behind each claim.
  { name: 'PMCare', panelType: PanelType.TPA },
  { name: 'MediExpress', panelType: PanelType.TPA },
  { name: 'MiCare', panelType: PanelType.TPA },
  { name: 'Medilink Global', panelType: PanelType.TPA },
  { name: 'Integrated Health Plans (IHP)', panelType: PanelType.TPA },
  { name: 'Health Metrics', panelType: PanelType.TPA },
  { name: 'MedKad', panelType: PanelType.TPA },
  { name: 'Fullerton Health', panelType: PanelType.TPA },
  { name: 'Asia Assistance Network', panelType: PanelType.TPA },

  // Insurers — they carry the risk themselves, so the panel and the payer are
  // the same body and the term is the insurer's own.
  { name: 'AIA', panelType: PanelType.INSURER },
  { name: 'Great Eastern', panelType: PanelType.INSURER },
  { name: 'Prudential', panelType: PanelType.INSURER },
  { name: 'Allianz', panelType: PanelType.INSURER },
  { name: 'Etiqa', panelType: PanelType.INSURER },
  { name: 'Zurich', panelType: PanelType.INSURER },
  { name: 'Hong Leong Assurance', panelType: PanelType.INSURER },
  { name: 'Tokio Marine', panelType: PanelType.INSURER },
  { name: 'MSIG', panelType: PanelType.INSURER },

  // Statutory and public bodies. Typically no portal and no admin fee, and the
  // two the clinic's own workbook names are both here.
  { name: 'PERKESO (SOCSO)', panelType: PanelType.GOVERNMENT },
  { name: 'MARA', panelType: PanelType.GOVERNMENT },
];

/**
 * PANELS FOR DEMO AND UAT TENANTS.
 *
 * Neutral labels on purpose. A demo tenant's claims, batches and remittances
 * are fabricated, and carrying a real company's name on fabricated money is
 * how a screenshot ends up looking like a statement about that company. These
 * names cannot be mistaken for anybody.
 */
export const DEMO_PANELS: readonly DefaultPanelSeedRow[] = [
  { name: 'Demo TPA A', panelType: PanelType.TPA },
  { name: 'Demo TPA B', panelType: PanelType.TPA },
  { name: 'Demo Insurer A', panelType: PanelType.INSURER },
  { name: 'Demo Corporate Client', panelType: PanelType.CORPORATE },
  { name: 'Demo Government Scheme', panelType: PanelType.GOVERNMENT },
];
