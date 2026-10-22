import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const entry = resolve(here, 'index.mts')
const manifest = JSON.parse(readFileSync(resolve(here, '../../package.json'), 'utf8')) as {
  peerDependenciesMeta: Record<string, { optional?: boolean }>
}
const optionalPeers = Object.entries(manifest.peerDependenciesMeta)
  .filter(([, meta]) => meta.optional === true)
  .map(([name]) => name)

function packageName(specifier: string): string {
  const parts = specifier.split('/')
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]!
}

/** Specifiers imported or re-exported at module load, excluding `import type` forms. */
function staticValueSpecifiers(source: string, file: string): string[] {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
  const specifiers: string[] = []
  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const clause = statement.importClause
      if (clause?.isTypeOnly) continue
      const named = clause?.namedBindings
      const onlyInlineTypes =
        clause !== undefined &&
        clause.name === undefined &&
        named !== undefined &&
        ts.isNamedImports(named) &&
        named.elements.length > 0 &&
        named.elements.every((element) => element.isTypeOnly)
      if (!onlyInlineTypes) specifiers.push(statement.moduleSpecifier.text)
    } else if (
      ts.isExportDeclaration(statement) &&
      !statement.isTypeOnly &&
      statement.moduleSpecifier !== undefined &&
      ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      specifiers.push(statement.moduleSpecifier.text)
    }
  }
  return specifiers
}

function staticGraph(): Map<string, string[]> {
  const importersByPeer = new Map<string, string[]>()
  const seen = new Set<string>()
  const queue = [entry]
  while (queue.length > 0) {
    const file = queue.pop()!
    if (seen.has(file)) continue
    seen.add(file)
    for (const specifier of staticValueSpecifiers(readFileSync(file, 'utf8'), file)) {
      if (specifier.startsWith('.')) {
        const target = resolve(dirname(file), specifier)
        if (existsSync(target)) queue.push(target)
        continue
      }
      const name = packageName(specifier)
      if (optionalPeers.includes(name)) {
        importersByPeer.set(name, [
          ...(importersByPeer.get(name) ?? []),
          file.replace(`${here}/`, ''),
        ])
      }
    }
  }
  return importersByPeer
}

describe('CLI entry optional peer policy', () => {
  it('declares no-mistakes as an optional peer', () => {
    expect(optionalPeers).toContain('no-mistakes')
  })

  it('never value-imports an optional peer from its static import graph', () => {
    expect(Object.fromEntries(staticGraph())).toEqual({})
  })

  it('ignores type-only imports and exports', () => {
    const source = [
      "import type { A } from 'no-mistakes'",
      "import { type B, type C } from 'no-mistakes'",
      "export type { D } from 'no-mistakes'",
      "import { e } from 'no-mistakes'",
      "export * from '@playwright/test'",
      "import 'typescript'",
      'void import("no-mistakes")',
    ].join('\n')
    expect(staticValueSpecifiers(source, 'x.mts')).toEqual([
      'no-mistakes',
      '@playwright/test',
      'typescript',
    ])
    expect(packageName('@playwright/test/foo')).toBe('@playwright/test')
    expect(packageName('no-mistakes/sub')).toBe('no-mistakes')
  })
})
