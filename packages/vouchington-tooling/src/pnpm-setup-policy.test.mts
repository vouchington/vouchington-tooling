import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

import { expandWorkspaceGlob } from './workspace-glob.mts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

type Step = { uses?: string; with?: Record<string, unknown> }
type StepList = { source: string; steps: Step[] }
type Manifest = {
  devEngines?: { packageManager?: unknown }
  engines?: { pnpm?: unknown }
  packageManager?: unknown
}

const pnpmSetup = /^pnpm\/action-setup@/
const nodeSetup = /^actions\/setup-node@/
const bareMajor = /^\d+$/
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

  it('installs pnpm through pnpm/action-setup in CI', () => {
    expect(setups.length).toBeGreaterThan(0)
  })

  it('passes pnpm/action-setup nothing but a bare pnpm major', () => {
    for (const { source, step } of setups) {
      expect(Object.keys(step.with ?? {}), source).toEqual(['version'])
      expect(String(step.with?.version), source).toMatch(bareMajor)
    }
  })

  it('requests the same pnpm major everywhere', () => {
    expect(new Set(setups.map(({ step }) => String(step.with?.version))).size).toBe(1)
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
