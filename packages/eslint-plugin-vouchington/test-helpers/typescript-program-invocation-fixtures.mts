interface Fixture {
  code: string
  expectedDiagnosticCount?: number
  file: string
}

const FILE = 'backend/test-helpers/api-fixtures/invocation-compiler.mts'

export const invocationInvalid: Fixture[] = [
  {
    file: FILE,
    expectedDiagnosticCount: 29,
    code: `import { createCompilerHost as factory } from 'typescript'
factory(options, true)
new (factory as any)(options, true)
factory\`template\`
@factory
class Decorated {}
class Host extends factory {}
new Host(options, true)
factory.call.call(factory, undefined, options)
const boundByCall = factory.bind.call(factory, undefined, options)
boundByCall()
const calledByBind = factory.call.bind(factory)
calledByBind(undefined, options)
Reflect.apply(factory.call, factory, [undefined, options])
const reflectedBound = Reflect.apply(Function.prototype.bind, factory, [undefined, options])
reflectedBound()
const proxied = new Proxy(factory, {})
proxied(options, true)
new (proxied as any)(options, true)
Reflect.apply(factory, undefined, [options, true])
Reflect.construct(factory, [options, true])
const revocable = Proxy.revocable(factory, {})
revocable.proxy(options, true)
const { proxy: destructuredProxy } = Proxy.revocable(factory, {})
destructuredProxy(options, true)
const { proxy } = Proxy.revocable(factory, {})
proxy(options, true)
Function.prototype.call.call(factory, undefined, options)
Reflect.apply(Function.prototype.apply, factory, [undefined, [options]])
Reflect.apply(Reflect.construct, Reflect, [factory, [options]])
const build = Reflect.construct.bind(Reflect, factory)
build([options])
const binder = factory.bind.bind(factory)
binder(undefined, options)
const boundAfterBinder = binder(undefined, options)
boundAfterBinder()
let reassignedBinder = domainBinder
reassignedBinder = factory.bind.bind(factory)
const reassignedBound = reassignedBinder(undefined, options)
reassignedBound()
Function.prototype.apply.call(factory, undefined, [options, true])
Reflect.apply(Function.prototype.call, factory, [undefined, options, true])
const functionBound = Function.prototype.bind.call(factory, undefined, options, true)
functionBound()
const functionCallBound = Function.prototype.call.bind(factory)
functionCallBound(undefined, options, true)
Reflect.construct.call(Reflect, factory, [options, true])
Reflect.construct.apply(Reflect, [factory, [options, true]])`,
  },
]

export const invocationValid: Fixture[] = [
  {
    file: FILE.replace('invocation', 'cyclic-heritage'),
    code: `import { createCompilerHost as factory } from 'typescript'
class Self extends Self {}
new Self(options, true)
class First extends Second {}
class Second extends First {}
new First(options, true)
void factory`,
  },
  {
    file: FILE.replace('invocation', 'binder-cyclic-alias'),
    code: `import { createCompilerHost as factory } from 'typescript'
const first = second
const second = first
first()
void factory`,
  },
  {
    file: FILE.replace('invocation', 'binder-reassigned-domain'),
    code: `import { createCompilerHost as factory } from 'typescript'
let binder = factory.bind.bind(factory)
binder = domainBinder
binder(undefined, options)
void factory`,
  },
  {
    file: FILE.replace('invocation', 'standard-global-shadow'),
    code: `import { createCompilerHost as factory } from 'typescript'
function build(Function, Reflect) {
  Function.prototype.apply.call(factory, undefined, [options, true])
  Reflect.apply(Function.prototype.call, factory, [undefined, options, true])
  const functionBound = Function.prototype.bind.call(factory, undefined, options, true)
  functionBound()
  const functionCallBound = Function.prototype.call.bind(factory)
  functionCallBound(undefined, options, true)
  Reflect.construct.call(Reflect, factory, [options, true])
  Reflect.construct.apply(Reflect, [factory, [options, true]])
}
void factory`,
  },
  {
    file: FILE.replace('invocation', 'noninvocation'),
    code: `import { createCompilerHost as factory } from 'typescript'
new (factory.call as any)(undefined, options)
new (factory.apply as any)(undefined, [options])
new (Reflect.apply as any)(factory, undefined, [options])`,
  },
  {
    file: FILE.replace('invocation', 'shadowed-wrappers'),
    code: `import { createCompilerHost as factory } from 'typescript'
function build(Reflect, Proxy) {
  Reflect.apply(factory, undefined, [options, true])
  Reflect.construct(factory, [options, true])
  const proxied = new Proxy(factory, {})
  proxied(options, true)
}`,
  },
  {
    file: FILE.replace('invocation', 'domain-wrappers'),
    code: `const factory = domainFactory
Reflect.apply(factory, undefined, [options, true])
Reflect.construct(factory, [options, true])
const proxied = new Proxy(factory, {})
proxied(options, true)`,
  },
  {
    file: FILE.replace('invocation', 'proxy-call'),
    code: `import { createCompilerHost as factory } from 'typescript'
const proxy = Proxy(factory, {})
proxy(options, true)`,
  },
  {
    file: FILE.replace('invocation', 'revocable-shadow'),
    code: `import { createCompilerHost as factory } from 'typescript'
function build(Proxy) {
  const { proxy } = Proxy.revocable(factory, {})
  proxy(options, true)
}`,
  },
  {
    file: FILE.replace('invocation', 'revocable-domain'),
    code: `const factory = domainFactory
const { proxy } = Proxy.revocable(factory, {})
proxy(options, true)`,
  },
  {
    file: FILE.replace('invocation', 'standard-shadow'),
    code: `import { createCompilerHost as factory } from 'typescript'
function build(Function, Reflect) {
  Function.prototype.call.call(factory, undefined, options)
  Reflect.apply(Function.prototype.apply, factory, [undefined, [options]])
  Reflect.apply(Reflect.construct, Reflect, [factory, [options]])
}`,
  },
  {
    file: FILE.replace('invocation', 'callback-sinks'),
    code: `import { createCompilerHost as factory } from 'typescript'
array.map(factory)
promise.then(factory)
const protocol = { [Symbol.iterator]: factory }
void protocol`,
  },
]
