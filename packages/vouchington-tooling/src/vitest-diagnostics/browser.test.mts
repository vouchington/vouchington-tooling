import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import * as browser from './browser.mts'

const ENTRY = resolve(dirname(fileURLToPath(import.meta.url)), 'browser.mts')
const SPECIFIER = /(?:\bfrom|\bimport)\s*\(?\s*['"]([^'"]+)['"]/g
const NODE_GLOBALS = /\b(?:process|require)\s*[.(]|\b(?:Buffer|__dirname|__filename)\b/

function stripLineComments(source: string): string {
  return source.replace(/^\s*\/\/.*$/gm, '')
}

function importGraph(entry: string): Map<string, string[]> {
  const graph = new Map<string, string[]>()
  const pending = [entry]
  for (let file = pending.pop(); file !== undefined; file = pending.pop()) {
    if (graph.has(file)) continue
    const source = stripLineComments(readFileSync(file, 'utf8'))
    const specifiers = [...source.matchAll(SPECIFIER)].map((match) => match[1] as string)
    graph.set(file, specifiers)
    for (const specifier of specifiers) {
      if (specifier.startsWith('.')) pending.push(resolve(dirname(file), specifier))
    }
  }
  return graph
}

describe('vitest-diagnostics browser entry', () => {
  it('exports only the fake-timer helpers', () => {
    expect(Object.keys(browser).toSorted()).toEqual([
      'checkAndRestoreFakeTimers',
      'formatFakeTimerLeakDiagnostics',
    ])
  })

  it('restores fake timers through the browser entry', () => {
    let restored = false
    const diagnostic = browser.checkAndRestoreFakeTimers(
      {
        isFakeTimers: () => true,
        useRealTimers: () => {
          restored = true
        },
      },
      'leaky test',
    )
    expect(restored).toBe(true)
    expect(diagnostic).toBe(browser.formatFakeTimerLeakDiagnostics('leaky test'))
  })

  it('has an import graph with only relative imports (no node:) and no Node globals', () => {
    const graph = importGraph(ENTRY)
    expect(graph.size).toBeGreaterThan(1)
    for (const [file, specifiers] of graph) {
      expect(
        specifiers.filter((specifier) => !specifier.startsWith('.')),
        file,
      ).toEqual([])
      const code = stripLineComments(readFileSync(file, 'utf8'))
      expect(code, file).not.toMatch(NODE_GLOBALS)
    }
  })
})
