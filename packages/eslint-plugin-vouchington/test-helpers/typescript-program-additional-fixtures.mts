import { followupInvalid, followupValid } from './typescript-program-followup-fixtures.mts'

interface Fixture {
  code: string
  expectedDiagnosticCount?: number
  file: string
}

const FILE = 'backend/test-helpers/api-fixtures/additional-compiler.mts'

export const additionalInvalid: Fixture[] = [
  {
    file: FILE.replace('compiler', 'host-factories'),
    expectedDiagnosticCount: 5,
    code: `import {
  createCompilerHost,
  createIncrementalCompilerHost,
  createSolutionBuilderHost,
  createSolutionBuilderWithWatchHost,
  createWatchCompilerHost,
} from 'typescript'
createCompilerHost(options, true)
createIncrementalCompilerHost(options)
createWatchCompilerHost(configFileName, options, system, createProgram, reportDiagnostic, reportStatus)
createSolutionBuilderHost(system, createProgram, reportDiagnostic, reportStatus, reportSolutionBuilderStatus)
createSolutionBuilderWithWatchHost(system, createProgram, reportDiagnostic, reportStatus, reportSolutionBuilderStatus)`,
  },
  {
    file: FILE,
    expectedDiagnosticCount: 8,
    code: `import {
  createAbstractBuilder,
  createBuilderProgram,
  createBuilderProgramUsingIncrementalBuildInfo,
  createRedirectedBuilderProgram,
  createSolutionBuilder,
  createSolutionBuilderWithWatch,
  createWatchProgram,
  readBuilderProgram,
} from 'typescript'
createAbstractBuilder(state)
createBuilderProgram(state)
createBuilderProgramUsingIncrementalBuildInfo(state)
createRedirectedBuilderProgram(state)
createSolutionBuilder(host)
createSolutionBuilderWithWatch(host)
createWatchProgram(host)
readBuilderProgram(options, host)`,
  },
  {
    file: FILE.replace('compiler', 'local-export'),
    code: `import { createProgram as buildProgram } from 'typescript'
export { buildProgram }`,
  },
  {
    file: FILE.replace('compiler', 'namespace-export'),
    code: `import * as compiler from 'typescript'
export { compiler as compilerApi }`,
  },
  {
    file: FILE.replace('compiler', 'variable-export'),
    code: `import ts from 'typescript'
export const buildProgram = ts.createProgram`,
  },
  {
    file: FILE.replace('compiler', 'default-factory-export'),
    code: `import ts from 'typescript'
export default ts.createLanguageService`,
  },
  {
    file: FILE.replace('compiler', 'direct-export'),
    code: `export { createProgram as buildProgram } from 'typescript'`,
  },
  {
    file: FILE.replace('compiler', 'export-all'),
    code: `export * from 'typescript'`,
  },
  {
    file: FILE.replace('compiler', 'virtual-optional-call'),
    code: `import { buildVirtualProgramMatrix } from './virtual-program.mts'
buildVirtualProgramMatrix?.(import.meta, sources)`,
  },
  {
    file: FILE.replace('compiler', 'virtual-generic-call'),
    code: `import { buildVirtualProgramMatrix } from './virtual-program.mts'
buildVirtualProgramMatrix<typeof sources>(import.meta, sources)`,
  },
  {
    file: FILE.replace('compiler', 'virtual-container-alias'),
    code: `import { it } from 'vitest'
import { buildVirtualProgramMatrix } from './virtual-program.mts'
const builders = [buildVirtualProgramMatrix]
it('builds', () => builders[0](import.meta, sources))`,
  },
  {
    file: FILE.replace('compiler', 'virtual-nested-callback'),
    code: `import { beforeAll } from 'vitest'
import { buildVirtualProgramMatrix } from './virtual-program.mts'
beforeAll(() => {
  run(() => buildVirtualProgramMatrix(import.meta, sources))
})`,
  },
  {
    file: FILE.replace('compiler', 'virtual-wrong-meta'),
    code: `import { beforeAll } from 'vitest'
import { buildVirtualProgramMatrix } from './virtual-program.mts'
beforeAll(() => buildVirtualProgramMatrix(moduleUrl, sources))`,
  },
  {
    file: FILE.replace('compiler', 'virtual-direct-export'),
    code: `export {
  buildVirtualProgramMatrix as buildMatrix
} from './virtual-program.mts'`,
  },
  {
    file: FILE.replace('compiler', 'virtual-local-export'),
    code: `import { buildVirtualProgramMatrix } from './virtual-program.mts'
const buildMatrix = buildVirtualProgramMatrix
export { buildMatrix }`,
  },
  {
    file: FILE.replace('compiler', 'virtual-export-all'),
    code: `export * from './virtual-program.mts'`,
  },
  ...followupInvalid,
]

export const additionalValid: Fixture[] = [
  {
    file: FILE.replace('compiler', 'type-export'),
    code: `export type { Program, createProgram } from 'typescript'`,
  },
  {
    file: FILE.replace('compiler', 'domain-export'),
    code: `export { createProgram } from '@domain/compiler'`,
  },
  {
    file: FILE.replace('compiler', 'nonfactory-export'),
    code: `export { SyntaxKind, flatten } from 'typescript'`,
  },
  {
    file: FILE.replace('compiler', 'local-domain-export'),
    code: `const buildProgram = domainBuildProgram
export { buildProgram }`,
  },
  {
    file: FILE.replace('compiler', 'virtual-before-all'),
    code: `import { beforeAll } from 'vitest'
import { buildVirtualProgramMatrix } from './virtual-program.mts'
beforeAll(() => buildVirtualProgramMatrix(import.meta, sources))`,
  },
  {
    file: FILE.replace('compiler', 'virtual-before-all-function'),
    code: `import { beforeAll } from 'vitest'
import { buildVirtualProgramMatrix } from './virtual-program.mts'
beforeAll(function () {
  buildVirtualProgramMatrix(import.meta, sources)
})`,
  },
  {
    file: FILE.replace('compiler', 'virtual-type-export'),
    code: `export type {
  buildVirtualProgramMatrix
} from './virtual-program.mts'`,
  },
  ...followupValid,
]
