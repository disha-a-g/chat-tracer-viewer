import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseTrace } from '../index'

// Confidence must be present on every assistant/thinking step (explicit or
// heuristic — finalize.ts's applyConfidence never skips one) and absent
// everywhere else. DetailPane's single `{step.confidence && (...)}` check
// relies on this holding for every format.
const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '../../fixtures')

const rawFixtures = [
  'fixture-short-success.claude-code.jsonl',
  'fixture-long-failure.openai.json',
  'fixture-pcori-success.generic.json',
  'swe_bench_failed_run.jsonl',
  'model_eval_failed_run.jsonl',
]

describe('confidence presence invariant', () => {
  for (const filename of rawFixtures) {
    it(`${filename}: confidence set iff step.type is assistant/thinking`, () => {
      const raw = readFileSync(join(fixturesDir, filename), 'utf-8')
      const trace = parseTrace(raw)
      expect(trace.steps.length).toBeGreaterThan(0)
      for (const step of trace.steps) {
        const shouldHaveConfidence = step.type === 'assistant' || step.type === 'thinking'
        expect(step.confidence !== undefined).toBe(shouldHaveConfidence)
        if (shouldHaveConfidence) {
          expect(typeof step.confidence?.value).toBe('number')
          expect(step.confidence?.value).toBeGreaterThanOrEqual(0)
          expect(step.confidence?.value).toBeLessThanOrEqual(1)
        }
      }
    })
  }
})
