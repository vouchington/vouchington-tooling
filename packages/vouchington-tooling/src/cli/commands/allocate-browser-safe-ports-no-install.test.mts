import { execFile as execFileCallback } from 'node:child_process'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const execFile = promisify(execFileCallback)
const packageDirectory = resolve('packages/vouchington-tooling')
const sourceScript = join(packageDirectory, 'scripts/allocate-browser-safe-ports.py')
const requiredFiles = [
  'package/scripts/allocate-browser-safe-ports.py',
  'package/scripts/fetch-forbidden-ports.json',
  'package/scripts/runner-port-policy.json',
]
const contract =
  'The allocator must stay stdlib-only and self-contained: CI runs it from the extracted ' +
  'published tarball with `python3`, with no `pnpm install`/`pnpm dlx` and no dependency ' +
  'resolution (which can fail under minimumReleaseAge). See packages/vouchington-tooling/README.md.'

const closureScript = `
import ast, json, sys
tree = ast.parse(open(sys.argv[1]).read())
modules, dynamic, joined = set(), [], set()
for node in ast.walk(tree):
    if isinstance(node, ast.Import):
        modules.update(alias.name.split('.')[0] for alias in node.names)
    elif isinstance(node, ast.ImportFrom):
        modules.add('.' * node.level if node.level else node.module.split('.')[0])
    elif isinstance(node, ast.Name) and node.id in ('__import__', 'importlib'):
        dynamic.append(node.id)
    elif isinstance(node, ast.Attribute) and node.attr in ('import_module', '__import__'):
        dynamic.append(node.attr)
    elif isinstance(node, ast.BinOp) and isinstance(node.op, ast.Div):
        if isinstance(node.left, ast.Name) and node.left.id == 'SCRIPT_DIR':
            joined.add(ast.literal_eval(node.right))
print(json.dumps({
    'nonStdlib': sorted(m for m in modules if m not in sys.stdlib_module_names),
    'modules': sorted(modules),
    'dynamic': dynamic,
    'scriptDirPaths': sorted(joined),
}))
`

function parsePorts(stdout: string): number[] {
  return stdout.trim().split(/\s+/).filter(Boolean).map(Number)
}

describe('allocate-browser-safe-ports.py no-install contract', () => {
  let workDirectory = ''
  let extractedRoot = ''
  let packedFiles: string[] = []

  beforeAll(async () => {
    workDirectory = await mkdtemp(join(tmpdir(), 'allocator-no-install-'))
    const packDirectory = join(workDirectory, 'pack')
    extractedRoot = join(workDirectory, 'extracted')
    await mkdir(packDirectory)
    await mkdir(extractedRoot)
    const { stdout } = await execFile(
      'npm',
      ['pack', '--ignore-scripts', '--json', '--pack-destination', packDirectory],
      { cwd: packageDirectory },
    )
    const packed = (JSON.parse(stdout) as unknown[])[0] as {
      filename: string
      files: { path: string }[]
    }
    packedFiles = packed.files.map((file) => `package/${file.path}`)
    await execFile('tar', ['-xzf', join(packDirectory, packed.filename), '-C', extractedRoot])
  }, 120_000)

  afterAll(() => rm(workDirectory, { force: true, recursive: true }))

  it('ships the allocator and both JSON siblings in the published tarball', () => {
    expect(packedFiles, contract).toEqual(expect.arrayContaining(requiredFiles))
  })

  it('allocates ports from the extracted tarball with isolated stdlib-only Python', async () => {
    const script = join(extractedRoot, 'package/scripts/allocate-browser-safe-ports.py')
    const { stdout } = await execFile('python3', ['-I', '-S', script, '4'], {
      cwd: extractedRoot,
      env: { PATH: process.env.PATH ?? '', GITHUB_ACTIONS: '' },
    })
    const ports = parsePorts(stdout)

    expect(ports, contract).toHaveLength(4)
    expect(new Set(ports).size).toBe(4)
    for (const port of ports) {
      expect(Number.isInteger(port)).toBe(true)
      expect(port < 2200 || port > 2999).toBe(true)
    }
  })

  it('imports only stdlib modules and reads only its two JSON siblings', async () => {
    const { stdout } = await execFile('python3', ['-I', '-c', closureScript, sourceScript])
    const closure = JSON.parse(stdout) as {
      nonStdlib: string[]
      modules: string[]
      dynamic: string[]
      scriptDirPaths: string[]
    }

    expect(closure.modules).toContain('__future__')
    expect(closure.nonStdlib, contract).toEqual([])
    expect(closure.dynamic, contract).toEqual([])
    expect(closure.scriptDirPaths, contract).toEqual([
      'fetch-forbidden-ports.json',
      'runner-port-policy.json',
    ])
  })
})
