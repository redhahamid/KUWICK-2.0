import { ProviderColor } from '@kuwick/shared';
import { NEUTRAL_PROVIDER_COLOR, providerColorFor } from '../calendar/doctor-color';

/**
 * THE avatar. Before the premium pass, four copies of `initialsOf` and three
 * different avatar treatments (antd Avatar, a bare `.kw-provider-avatar`
 * span with inline size overrides, and two bespoke public/flow spans)
 * rendered the same idea. One component now; the CSS sizes live under
 * `.kw-avatar` in appointment-v3.css §13.
 *
 * PATIENTS ARE NEUTRAL BY DESIGN (approved decision 1). A patient avatar is
 * monogram initials on slate — never a gendered silhouette, never a pink/blue
 * coding. Initials tell two Sitis apart on a busy morning; a silhouette tells
 * you nothing you needed and asserts something you were not asked to display.
 * Recorded sex stays where it is useful and unambiguous: check-in, patient
 * details, the record itself.
 *
 * PROVIDERS WEAR THEIR OWN COLOUR. Pass `color` (from useProviderColors) so
 * the avatar shows the doctor's PERSISTED identity colour; `colorSeed` alone
 * still resolves through the deterministic fallback for the surfaces that do
 * not hold the staff list.
 */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  const first = words[0][0] ?? '';
  const second = words.length > 1 ? (words[1][0] ?? '') : '';
  return `${first}${second}`.toUpperCase() || '?';
}

export interface PersonAvatarProps {
  name: string;
  /**
   * The provider's resolved identity colour — the stored one where the caller
   * can see it. Wins over `colorSeed`.
   */
  color?: ProviderColor;
  /**
   * Deterministic fallback identity — pass the STAFF ID for providers on
   * surfaces without the staff list. Omitted (a patient, a guest) renders the
   * neutral slate treatment.
   */
  colorSeed?: string | null;
  /** 'xs' is the in-card size — a 16px identity dot beside a doctor's name;
   *  'xl' is the drawer identity-header size. */
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  /**
   * THE SEAM FOR A REAL PHOTOGRAPH. Nothing in Kuwick stores patient or staff
   * photographs today, so nothing passes this — and no placeholder face is
   * invented to fill the space. It exists so that the day a photo model does
   * arrive, every avatar on every surface picks it up without a single card
   * being redrawn: the monogram is the fallback, not the design.
   */
  photoUrl?: string | null;
}

export function PersonAvatar({
  name,
  color,
  colorSeed,
  size = 'md',
  className,
  photoUrl,
}: PersonAvatarProps) {
  const identity = color ?? (colorSeed ? providerColorFor(null, colorSeed) : NEUTRAL_PROVIDER_COLOR);
  return (
    <span
      className={`kw-avatar${className ? ` ${className}` : ''}`}
      data-size={size}
      data-photo={photoUrl ? 'true' : undefined}
      style={{ background: identity.pastel, color: identity.text }}
      aria-hidden="true"
    >
      {photoUrl ? <img src={photoUrl} alt="" /> : initialsOf(name)}
    </span>
  );
}
