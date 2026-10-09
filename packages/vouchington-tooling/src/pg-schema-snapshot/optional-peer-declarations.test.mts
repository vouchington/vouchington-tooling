import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from '@typescript/typescript6'
import { expect, it } from 'vitest'

it('typechecks snapshot consumers with no optional parser peer and library checks enabled', async () => {
  const root = await mkdtemp(join(tmpdir(), 'snapshot-optional-peer-'))
  try {
    const installed = join(root, 'node_modules/vouchington-tooling')
    await mkdir(installed, { recursive: true })
    await cp(
      fileURLToPath(new URL('../../dist/pg-schema-snapshot', import.meta.url)),
      join(installed, 'dist/pg-schema-snapshot'),
      { recursive: true, filter: (source) => !source.endsWith('.mjs') },
    )
    await writeFile(
      join(installed, 'package.json'),
      JSON.stringify({
        name: 'vouchington-tooling',
        type: 'module',
        exports: { './pg-schema-snapshot': './dist/pg-schema-snapshot/index.d.mts' },
      }),
    )
    const consumer = join(root, 'consumer.mts')
    await writeFile(
      consumer,
      `import { buildSchemaSnapshot, projectGeneratedArbiterInput } from 'vouchington-tooling/pg-schema-snapshot'
export const build = buildSchemaSnapshot
export const projected = projectGeneratedArbiterInput({
  target: { kind: 'omitted' }, predicate: null, action: { kind: 'doNothing' },
})`,
    )
    const program = ts.createProgram([consumer], {
      noEmit: true,
      strict: true,
      skipLibCheck: false,
      types: [],
      target: ts.ScriptTarget.ES2023,
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
    })
    expect(
      ts
        .getPreEmitDiagnostics(program)
        .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')),
    ).toEqual([])
    expect(program.getSourceFiles().some((file) => file.fileName.includes('/no-mistakes/'))).toBe(
      false,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
