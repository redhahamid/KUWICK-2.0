import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * The commit this bundle was built from, resolved at BUILD time: Railway
 * stamps RAILWAY_GIT_COMMIT_SHA, GitHub Actions stamps GITHUB_SHA, and a
 * local checkout falls back to asking git. A deployment mismatch cost a full
 * owner review because nothing anywhere said which commit was serving; the
 * avatar menu now says it.
 */
function buildSha(): string {
  const fromEnv = process.env.RAILWAY_GIT_COMMIT_SHA ?? process.env.GITHUB_SHA;
  if (fromEnv) return fromEnv.slice(0, 7);
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return 'untracked-local';
  }
}

export default defineConfig({
  plugins: [react()],
  define: {
    __BUILD_SHA__: JSON.stringify(buildSha()),
  },
  server: {
    port: Number(process.env.PORT) || 5173,
    strictPort: true,
  },
});
