// The fixed-name marks of the remote sync profile (see sync-profile.ts). They stay in this file, apart
// from the request records, so the web sign-in screen sets them without loading Effect.

/**
 * Marks a connect or sync phase with `performance.mark("openbot:remote-<name>")`. The name is a fixed
 * word, never data. Only the latest mark of each name stays, so a tab that reconnects for days keeps
 * no more marks. React Native can lack the User Timing API; the mark is then skipped.
 */
export function markRemoteSync(name: string): void {
  const clock = globalThis.performance;
  if (!clock || typeof clock.mark !== "function") return;
  const mark = `openbot:remote-${name}`;
  if (typeof clock.clearMarks === "function") clock.clearMarks(mark);
  clock.mark(mark);
}
