/**
 * React's `scheduler` ships no types, and only one thing in this app touches it
 * directly: `schedulerLifetime.test.tsx`, which calls it to prove React binds
 * its host callback to the document's timer rather than to Node's process-wide
 * `setImmediate` (see `test-scheduler-lifetime.ts` for the teardown race that
 * pins down). Just the two members that test uses — anything wider would be an
 * invitation to schedule application work here, which is React's job.
 */
declare module 'scheduler' {
  export const unstable_NormalPriority: number;
  export function unstable_scheduleCallback(
    priority: number,
    callback: () => unknown,
  ): unknown;
}
