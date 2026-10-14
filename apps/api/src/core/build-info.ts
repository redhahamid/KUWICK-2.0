/**
 * The commit this process was built from, resolved at RUNTIME from whatever
 * the platform provides: Railway stamps RAILWAY_GIT_COMMIT_SHA into both
 * build and runtime, GitHub Actions stamps GITHUB_SHA, and a bare local run
 * says so honestly instead of inventing one.
 *
 * This exists because a deployment mismatch cost a full owner review: master
 * was green, the deployed app was old, and nothing anywhere said which
 * commit was actually serving. Now /health answers.
 */
// Render sets RENDER_GIT_COMMIT on every build (15 October 2026: staging moved to Render).
const sha =
  process.env.RENDER_GIT_COMMIT ?? process.env.RAILWAY_GIT_COMMIT_SHA ?? process.env.GITHUB_SHA ?? process.env.KUWICK_BUILD_SHA;
export const BUILD_SHA = sha ? sha.slice(0, 7) : 'untracked-local';
