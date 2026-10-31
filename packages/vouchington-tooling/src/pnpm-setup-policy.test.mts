import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

import { expandWorkspaceGlob } from './workspace-glob.mts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

type Step = {
  env?: Record<string, string>
  id?: string
  run?: string
  uses?: string
  with?: Record<string, unknown>
}
type StepList = { source: string; steps: Step[] }
type Manifest = {
  devEngines?: { packageManager?: unknown }
  engines?: { pnpm?: unknown }
  packageManager?: unknown
}

const pnpmSetup = /^pnpm\/setup@[0-9a-f]{40}$/
const nodeSetup = /^actions\/setup-node@/
const resolvedVersion = /^\$\{\{ steps\.([\w-]+)\.outputs\.version \}\}$/
const resolver = /(?:^|\/)resolve-pnpm-version(?:\/resolve\.mjs)?(?:\s|"|$)/
const manualActivation = [
  /\bcorepack\b/i,
  /\bpnpm@\d/,
  /\bnpx\s+(?:-\S+\s+)*pnpm\b/,
  /\bnpm\s+(?:install|i|add)\b[^\n]*\bpnpm(?:@|\s|$)/m,
]

function read(file: string) {
  return readFileSync(resolve(root, file), 'utf8')
}

function filesUnder(directory: string) {
  return readdirSync(resolve(root, directory), { recursive: true, encoding: 'utf8' })
    .map((name) => join(directory, name))
    .filter((file) => statSync(resolve(root, file)).isFile())
    .toSorted()
}

function yamlFiles(directory: string, basename: RegExp) {
  return filesUnder(directory).filter((file) => basename.test(file.split('/').at(-1)!))
}

function stepLists(): StepList[] {
  const workflows = yamlFiles('.github/workflows', /\.ya?ml$/).flatMap((file) => {
    const workflow = parse(read(file)) as { jobs: Record<string, { steps?: Step[] }> }
    return Object.entries(workflow.jobs).map(([job, { steps = [] }]) => ({
      source: `${file}#${job}`,
      steps,
    }))
  })
  const actions = yamlFiles('.github/actions', /^action\.ya?ml$/).map((file) => {
    const action = parse(read(file)) as { runs: { steps?: Step[] } }
    return { source: file, steps: action.runs.steps ?? [] }
  })
  return [...workflows, ...actions]
}

function workspaceManifests() {
  const workspace = parse(read('pnpm-workspace.yaml')) as { packages: string[] }
  const directories = [
    root,
    ...workspace.packages.flatMap((pattern) => expandWorkspaceGlob(root, pattern)),
  ]
  return directories
    .map((directory) => join(directory, 'package.json'))
    .filter((file) => existsSync(file))
    .map((file) => relative(root, file))
}

describe('pnpm setup policy', () => {
  const setups = stepLists().flatMap(({ source, steps }) =>
    steps.flatMap((step, index) =>
      pnpmSetup.test(step.uses ?? '') ? [{ before: steps.slice(0, index), source, step }] : [],
    ),
  )
  const manifests = workspaceManifests()

  it('installs pnpm through a SHA-pinned pnpm/setup in workflows', () => {
    expect(setups.length).toBeGreaterThan(0)
  })

  it('passes pnpm/setup a version from the resolver step and installs nothing else', () => {
    for (const { before, source, step } of setups) {
      expect(Object.keys(step.with ?? {}).toSorted(), source).toEqual([
        'install',
        'node-version-file',
        'version',
      ])
      const id = resolvedVersion.exec(String(step.with?.version))?.[1]
      expect(id, source).toBeDefined()
      const producer = before.find((candidate) => candidate.id === id)
      expect(`${producer?.uses ?? ''} ${producer?.run ?? ''}`, source).toMatch(resolver)
      expect(producer?.with, source).toBeUndefined()
      expect(step.with?.install, source).toBe(false)
      expect(step.with?.['node-version-file'], source).toBe(false)
    }
  })

  it('downloads pnpm in the setup action from the resolver output, never from pnpm/setup', () => {
    const action = stepLists().find(({ source }) => source.endsWith('setup-node-pnpm/action.yml'))!
    const download = action.steps.findIndex((step) => /download-pnpm\.mjs/.test(step.run ?? ''))
    const resolved = action.steps.findIndex((step) => resolver.test(step.run ?? ''))
    expect(action.steps.some((step) => pnpmSetup.test(step.uses ?? ''))).toBe(false)
    expect(resolved).toBeGreaterThanOrEqual(0)
    expect(download).toBeGreaterThanOrEqual(0)
    expect(download).toBeGreaterThan(resolved)
    const id = action.steps[resolved]!.id
    expect(action.steps[download]!.env?.PNPM_VERSION).toBe(`\${{ steps.${id}.outputs.version }}`)
    const node = action.steps.findIndex((step) => nodeSetup.test(step.uses ?? ''))
    expect(node).toBeGreaterThanOrEqual(0)
    expect(node).toBeLessThan(download)
    expect(read('.github/actions/setup-node-pnpm/download-pnpm.mjs')).not.toMatch(/\d+\.\d+\.\d+/)
  })

  it('never installs a runtime or caches the store through pnpm/setup', () => {
    for (const { source, step } of setups) {
      expect(step.with, source).not.toHaveProperty('runtime')
      expect(step.with, source).not.toHaveProperty('cache')
    }
  })

  it('sets up Node before pnpm in the same job or composite action', () => {
    for (const { before, source } of setups) {
      expect(
        before.some((step) => nodeSetup.test(step.uses ?? '')),
        source,
      ).toBe(true)
    }
  })

  it('never pins pnpm in a workspace manifest', () => {
    expect(manifests).toContain('package.json')
    expect(manifests.length).toBeGreaterThan(1)
    const pins = manifests.map((file) => {
      const manifest = JSON.parse(read(file)) as Manifest
      return [
        file,
        manifest.packageManager,
        manifest.devEngines?.packageManager,
        manifest.engines?.pnpm,
      ]
    })
    expect(pins).toEqual(manifests.map((file) => [file, undefined, undefined, undefined]))
  })

  it('never activates pnpm through Corepack, npx, or a global npm install', () => {
    const scanned = [
      ...filesUnder('.github/workflows'),
      ...filesUnder('.github/actions'),
      ...manifests,
    ]
    const activations = scanned.flatMap((file) => {
      const text = read(file)
      return manualActivation
        .filter((pattern) => pattern.test(text))
        .map((pattern) => `${file}: ${pattern.source}`)
    })
    expect(activations).toEqual([])
  })
})
