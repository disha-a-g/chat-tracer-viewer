import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { detectFormat, parseTrace } from '../index'

// Real ~/.claude/projects/**/*.jsonl session dumps (not synthetic). Their
// first lines are "mode" / "permission-mode" / "file-history-snapshot"
// envelopes carrying a sessionId but no uuid — only actual message-turn
// lines have both. detectFormat() used to check line 1 only, so every one
// of these misdetected as generic-json and failed outright (the generic
// adapter tries to JSON.parse the whole multi-line document as one object).
// Regression test for that fix in adapters/index.ts.
const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '../../fixtures')

const realSessionFixtures = ['fixture-dmls-build-lock.claude-code.jsonl', 'fixture-multiboot2-uefi-gop.claude-code.jsonl']

describe('real Claude Code session fixtures', () => {
  for (const filename of realSessionFixtures) {
    it(`${filename} is detected as claude-code-jsonl and parses with no errors`, () => {
      const raw = readFileSync(join(fixturesDir, filename), 'utf-8')
      expect(detectFormat(raw)).toBe('claude-code-jsonl')

      const trace = parseTrace(raw)
      expect(trace.format).toBe('claude-code-jsonl')
      expect(trace.steps.length).toBeGreaterThan(0)
      expect(trace.issues.filter((i) => i.severity === 'error')).toHaveLength(0)
    })
  }
})
