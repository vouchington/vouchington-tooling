interface Fixture {
  code: string
  expectedDiagnosticCount?: number
  file: string
}

const FILE = 'backend/test-helpers/api-fixtures/require-compiler.mts'

export const requireInvalid: Fixture[] = [
  {
    file: FILE.replace('compiler', 'host-container'),
    expectedDiagnosticCount: 11,
    code: `import { createRequire } from 'node:module'
const makeRequire = createRequire
const load = makeRequire(import.meta.url)
const compiler = load('typescript')
const hosts = [compiler.createCompilerHost]
const compilerApi = { host: compiler.createIncrementalCompilerHost }
hosts[0](options, true)
compilerApi.host(options)
hosts[0].call(undefined, options, true)
compilerApi.host.apply(undefined, [options])
const boundHost = hosts[0].bind(undefined, options, true)
boundHost()
Reflect.apply(hosts[0], undefined, [options, true])
new (hosts[0] as any)(options, true)
Reflect.construct(hosts[0], [options, true])
Reflect.construct.apply(Reflect, [hosts[0], [options, true]])
const proxiedHost = new Proxy(hosts[0], {})
proxiedHost(options, true)
const reflectedBoundHost = Reflect.apply(Function.prototype.bind, hosts[0], [undefined, options, true])
reflectedBoundHost()`,
  },
  {
    file: FILE,
    code: `import { createRequire } from 'node:module'
const requireFromHere = createRequire(import.meta.url)
const ts = requireFromHere('typescript')
ts.createProgram(files, options)`,
  },
  {
    file: FILE.replace('compiler', 'direct'),
    code: `import { createRequire } from 'node:module'
createRequire(import.meta.url)('typescript').createLanguageService(host)`,
  },
  {
    file: FILE.replace('compiler', 'destructured'),
    code: `import { createRequire } from 'module'
const requireFromHere = createRequire(import.meta.url)
const { createIncrementalProgram: makeProgram } = requireFromHere('typescript')
makeProgram(options)`,
  },
  {
    file: FILE.replace('compiler', 'aliased'),
    code: `import * as nodeModule from 'node:module'
const moduleApi = nodeModule
const { createRequire: makeRequire } = moduleApi
const loadModule = makeRequire(import.meta.url)
const requireAlias = loadModule
const compiler = requireAlias('typescript')
compiler['createSemanticDiagnosticsBuilderProgram'](files, options)`,
  },
]

export const requireValid: Fixture[] = [
  {
    file: FILE.replace('compiler', 'reflect-shadow'),
    code: `import { createCompilerHost } from 'typescript'
function build(Reflect) {
  return Reflect.apply(createCompilerHost, undefined, [options, true])
}
build(domainReflect)`,
  },
  {
    file: FILE.replace('compiler', 'reflect-domain-factory'),
    code: `Reflect.apply(domainFactory, undefined, [options, true])`,
  },
  {
    file: FILE.replace('compiler', 'require-like'),
    code: `const requireFromHere = makeDomainRequire()
const compiler = requireFromHere('typescript')
compiler.createProgram(files, options)`,
  },
  {
    file: FILE.replace('compiler', 'domain-module'),
    code: `import { createRequire } from 'node:module'
const requireFromHere = createRequire(import.meta.url)
const compiler = requireFromHere('@domain/typescript')
compiler.createProgram(files, options)`,
  },
  {
    file: FILE.replace('compiler', 'create-require-shadow'),
    code: `import { createRequire } from 'node:module'
function build(createRequire: DomainFactory) {
  const compiler = createRequire(import.meta.url)('typescript')
  return compiler.createProgram(files, options)
}`,
  },
  {
    file: FILE.replace('compiler', 'namespace-latest-kill'),
    code: `import { createRequire } from 'node:module'
const requireFromHere = createRequire(import.meta.url)
let compiler = requireFromHere('typescript')
compiler = domainCompiler
compiler.createProgram(files, options)`,
  },
  {
    file: FILE.replace('compiler', 'require-latest-kill'),
    code: `import { createRequire } from 'node:module'
let requireFromHere = createRequire(import.meta.url)
requireFromHere = domainRequire
const compiler = requireFromHere('typescript')
compiler.createProgram(files, options)`,
  },
]
