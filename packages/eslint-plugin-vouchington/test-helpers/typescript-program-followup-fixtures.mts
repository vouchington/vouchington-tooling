interface Fixture {
  code: string
  expectedDiagnosticCount?: number
  file: string
}

const FILE = 'backend/test-helpers/api-fixtures/followup-compiler.mts'

export const followupInvalid: Fixture[] = [
  {
    file: FILE.replace('compiler', 'virtual-namespace-call'),
    code: `import * as virtualProgram from './virtual-program.mts'
it('builds', () => virtualProgram.buildVirtualProgramMatrix(import.meta, sources))`,
  },
  {
    file: FILE.replace('compiler', 'virtual-namespace-extracted'),
    code: `import * as virtualProgram from './virtual-program.mts'
const build = virtualProgram.buildVirtualProgramMatrix
it('builds', () => build(import.meta, sources))`,
  },
  {
    file: FILE.replace('compiler', 'virtual-namespace-export'),
    code: `import * as virtualProgram from './virtual-program.mts'
export { virtualProgram }`,
  },
  {
    file: FILE.replace('compiler', 'virtual-vitest-shadow'),
    code: `import * as vitest from 'vitest'
import { buildVirtualProgramMatrix } from './virtual-program.mts'
function register(vitest) {
  vitest.beforeAll(() => buildVirtualProgramMatrix(import.meta, sources))
}
register(domainTests)`,
  },
  {
    file: FILE.replace('compiler', 'factory-object-export'),
    code: `import { createProgram } from 'typescript'
const compilerApi = { createProgram }
export { compilerApi }`,
  },
  {
    file: FILE.replace('compiler', 'builder-array-default'),
    code: `import { buildVirtualProgramMatrix as builder } from './virtual-program.mts'
export default [builder]`,
  },
  {
    file: FILE.replace('compiler', 'factory-spread-export'),
    code: `import { createProgram } from 'typescript'
const restricted = { createProgram }
export default { ...restricted }`,
  },
  {
    file: FILE.replace('compiler', 'factory-member-write-export'),
    code: `import { createProgram } from 'typescript'
const compilerApi = {}
compilerApi.factory = createProgram
export { compilerApi }`,
  },
  {
    file: FILE.replace('compiler', 'factory-late-root-export'),
    code: `import { createProgram } from 'typescript'
export let compilerApi
compilerApi = { createProgram }`,
  },
  {
    file: FILE.replace('compiler', 'factory-late-member-export'),
    code: `import { createProgram } from 'typescript'
export const compilerApi = {}
compilerApi.factory = createProgram`,
  },
  {
    file: FILE.replace('compiler', 'factory-late-destructured-export'),
    code: `import { createProgram } from 'typescript'
export let { compilerApi } = domainApis
compilerApi.factory = createProgram`,
  },
  {
    file: FILE.replace('compiler', 'builder-late-export'),
    code: `import { buildVirtualProgramMatrix as builder } from './virtual-program.mts'
export let compilerApi
compilerApi = [builder]`,
  },
  {
    file: FILE.replace('compiler', 'virtual-namespace-late-export'),
    code: `import * as virtualProgram from './virtual-program.mts'
export const compilerApi = {}
compilerApi.builder = virtualProgram.buildVirtualProgramMatrix`,
  },
]

export const followupValid: Fixture[] = [
  {
    file: FILE.replace('compiler', 'virtual-vitest-namespace'),
    code: `import * as vitest from 'vitest'
import * as virtualProgram from './virtual-program.mts'
vitest.beforeAll(() =>
  virtualProgram.buildVirtualProgramMatrix(import.meta, sources),
)`,
  },
  {
    file: FILE.replace('compiler', 'virtual-namespace-shadow'),
    code: `import * as virtualProgram from './virtual-program.mts'
function build(virtualProgram) {
  return virtualProgram.buildVirtualProgramMatrix(import.meta, sources)
}
build(domainVirtualProgram)`,
  },
  {
    file: FILE.replace('compiler', 'safe-compiler-container'),
    code: `import { flatten, SyntaxKind } from 'typescript'
const compilerApi = { flatten, SyntaxKind }
export { compilerApi }`,
  },
  {
    file: FILE.replace('compiler', 'factory-object-overwrite'),
    code: `import { createProgram } from 'typescript'
let compilerApi = { createProgram }
compilerApi = { flatten: domainFlatten }
export { compilerApi }`,
  },
  {
    file: FILE.replace('compiler', 'factory-member-overwrite'),
    code: `import { createProgram } from 'typescript'
const compilerApi = { createProgram }
compilerApi.createProgram = domainCreateProgram
export { compilerApi }`,
  },
  {
    file: FILE.replace('compiler', 'factory-late-root-kill'),
    code: `import { createProgram } from 'typescript'
export let compilerApi
compilerApi = { createProgram }
compilerApi = { flatten: domainFlatten }`,
  },
  {
    file: FILE.replace('compiler', 'factory-late-member-kill'),
    code: `import { createProgram } from 'typescript'
export const compilerApi = {}
compilerApi.factory = createProgram
compilerApi.factory = domainCreateProgram`,
  },
  {
    file: FILE.replace('compiler', 'virtual-namespace-late-kill'),
    code: `import * as virtualProgram from './virtual-program.mts'
export let compilerApi
compilerApi = virtualProgram
compilerApi = domainVirtualProgram`,
  },
]
