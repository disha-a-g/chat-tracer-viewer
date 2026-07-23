import { defineConfig, configDefaults } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    // Git worktrees (used for isolated subagent work) land inside .claude/,
    // which is nested under the repo root — without this, vitest's default
    // recursive scan picks up every worktree's full copy of the test suite
    // too, silently multiplying the reported test count.
    exclude: [...configDefaults.exclude, '.claude/**'],
  },
})
