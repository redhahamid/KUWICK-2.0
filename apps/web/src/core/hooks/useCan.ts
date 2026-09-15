import { useAuthStore } from '../auth-store';

/**
 * PHASE 1 (appointment UAT) — "can I?", answered from what the SERVER said.
 *
 * The login/refresh payload publishes `staff.permissions` — the exact set the
 * server resolved with its own `can()` — precisely so the browser never
 * derives a second answer from the role and gets a different one. This hook
 * is the one place the appointment module reads it, and the reason a doctor
 * no longer sees a fully-active "Check in" button that only fails after the
 * click: an action the account cannot perform is disabled (with the reason)
 * or absent, decided by the same facts the server will enforce.
 *
 * A session minted before the field existed carries no array. Absent means
 * "fall back", never "no" (the store documents this for its sibling fields):
 * the UI renders the action and the server remains the enforcer — exactly
 * yesterday's behaviour, only for stale sessions, only until their next
 * refresh repopulates the field.
 */
export function useCan(permission: string): boolean {
  return useAuthStore((state) => {
    const permissions = state.staff?.permissions;
    if (!permissions) return true;
    return permissions.includes(permission);
  });
}

/**
 * The same answer as `useCan`, for a LIST whose length is not known in advance.
 *
 * A hook cannot be called once per nav entry, so filtering a rail needs the
 * permission set in hand rather than one question at a time. The rule is
 * `useCan`'s, unchanged: absent means fall back and draw it, because a session
 * minted before the field existed must keep working until its next refresh.
 */
export function useCanCheck(): (permission: string | undefined) => boolean {
  const permissions = useAuthStore((state) => state.staff?.permissions);
  return (permission) => {
    if (!permission) return true;
    if (!permissions) return true;
    return permissions.includes(permission);
  };
}

/** The sentence a disabled control explains itself with. */
export function permissionHint(doing: string): string {
  return `Your account is not permitted to ${doing}. Ask the clinic owner if you need this.`;
}
