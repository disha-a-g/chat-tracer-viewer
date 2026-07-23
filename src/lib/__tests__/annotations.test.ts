import { describe, expect, it } from 'vitest'
import {
  annotationsStorageKey,
  decodeAnnotationsFromUrl,
  encodeAnnotationsForUrl,
  loadAnnotationsFromStorage,
  mergeAnnotations,
  saveAnnotationsToStorage,
} from '../annotations'
import type { Annotation } from '../annotations'
import { FakeStorage } from './testHelpers'

function note(stepId: string, text: string): Annotation {
  return { id: `note_${stepId}_${text.length}`, stepId, text, createdAt: '2026-01-01T00:00:00.000Z' }
}

describe('annotations storage', () => {
  it('round-trips through a fake Storage', () => {
    const storage = new FakeStorage()
    const notes = [note('s1', 'root cause here'), note('s2', 'second note')]
    saveAnnotationsToStorage('trc_abc', notes, storage)
    expect(loadAnnotationsFromStorage('trc_abc', storage)).toEqual(notes)
  })

  it('returns an empty array for a trace with no stored annotations', () => {
    expect(loadAnnotationsFromStorage('trc_missing', new FakeStorage())).toEqual([])
  })

  it('namespaces keys per trace id', () => {
    expect(annotationsStorageKey('trc_abc')).toBe('chat-trace-viewer:annotations:trc_abc')
  })

  it('never throws when storage.setItem throws', () => {
    const storage = new FakeStorage()
    storage.setItem = () => {
      throw new Error('QuotaExceededError')
    }
    expect(() => saveAnnotationsToStorage('trc_abc', [note('s1', 'x')], storage)).not.toThrow()
  })
})

describe('URL encoding', () => {
  it('round-trips stepId and text (id/createdAt are regenerated)', () => {
    const notes = [note('s1', 'this is the root cause'), note('s2', 'quiet failure here')]
    const encoded = encodeAnnotationsForUrl(notes)
    expect(encoded).not.toBeNull()
    const decoded = decodeAnnotationsFromUrl(encoded)
    expect(decoded.map((a) => [a.stepId, a.text])).toEqual([
      ['s1', 'this is the root cause'],
      ['s2', 'quiet failure here'],
    ])
  })

  it('returns null for an empty list, and [] for null/garbage input', () => {
    expect(encodeAnnotationsForUrl([])).toBeNull()
    expect(decodeAnnotationsFromUrl(null)).toEqual([])
    expect(decodeAnnotationsFromUrl('not-json')).toEqual([])
    expect(decodeAnnotationsFromUrl(JSON.stringify({ not: 'an array' }))).toEqual([])
  })

  it('survives special characters (quotes, unicode, newlines) in note text', () => {
    const notes = [note('s1', 'has "quotes", emoji-free unicode — café, and\nnewlines')]
    const decoded = decodeAnnotationsFromUrl(encodeAnnotationsForUrl(notes))
    expect(decoded[0].text).toBe(notes[0].text)
  })
})

describe('mergeAnnotations', () => {
  it('appends incoming annotations not already present locally', () => {
    const local = [note('s1', 'a')]
    const incoming = [note('s1', 'a'), note('s2', 'b')]
    const merged = mergeAnnotations(local, incoming)
    expect(merged).toHaveLength(2)
    expect(merged.map((a) => a.stepId)).toEqual(['s1', 's2'])
  })

  it('de-duplicates identical (stepId, text) pairs from re-opening the same link', () => {
    const local = [note('s1', 'a')]
    const merged = mergeAnnotations(local, [note('s1', 'a')])
    expect(merged).toHaveLength(1)
  })
})
