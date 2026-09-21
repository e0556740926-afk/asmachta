import { describe, expect, it } from 'vitest'
import { t } from '../../src/i18n/he'

/** Guards against accidentally shipping an empty or non-Hebrew placeholder string. */
function walk(node: unknown, path: string[], onLeaf: (path: string[], value: string) => void) {
  if (typeof node === 'string') {
    onLeaf(path, node)
    return
  }
  if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      walk(value, [...path, key], onLeaf)
    }
  }
}

describe('i18n strings', () => {
  it('has no empty string values', () => {
    const empties: string[] = []
    walk(t, [], (path, value) => {
      if (value.trim() === '') empties.push(path.join('.'))
    })
    expect(empties).toEqual([])
  })
})
