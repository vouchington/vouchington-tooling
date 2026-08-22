import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { Cmd, Copy, DockerfileParser, Run } from 'dockerfile-ast'

import { collectStages, type StageInstruction } from './stages.mts'

export interface DockerfileRuntimeImage {
  stage: string
  pnpmFilter: string
  cmdPath: string
  workspaceDir: string
}

export interface ParseDockerfileRuntimeImagesOptions {
  // Directory containing the package.json whose `workspaces:` field defines
  // the workspaces tree to search.
  monorepoRoot: string
  copySourcePrefix?: string
}

export function parseDockerfileRuntimeImages(
  dockerfile: string,
  { monorepoRoot, copySourcePrefix = '/prod/' }: ParseDockerfileRuntimeImagesOptions,
): DockerfileRuntimeImage[] {
  const parser = DockerfileParser.parse(dockerfile)
  const stages = collectStages(parser)
  const targetToFilter = collectDeployTargets(stages)

  const images: DockerfileRuntimeImage[] = []
  for (const { stage, instructions } of stages) {
    const target = matchCopyTarget(instructions, copySourcePrefix)
    if (!target) continue

    const pnpmFilter = targetToFilter.get(target)
    if (!pnpmFilter) continue

    const cmdPath = matchCmdScriptPath(instructions)
    if (!cmdPath) continue

    images.push({
      stage,
      pnpmFilter,
      cmdPath,
      workspaceDir: findWorkspaceDirByPackageName(monorepoRoot, pnpmFilter),
    })
  }
  return images
}

function collectDeployTargets(
  stages: readonly { instructions: StageInstruction[] }[],
): Map<string, string> {
  const deployRegex =
    /pnpm(?:\s+--?\S+(?:\s+(?!deploy\b)\S+)?)*\s+deploy\s+--filter\s+(\S+)\s+--prod\s+(\/\S+)/g
  const targetToFilter = new Map<string, string>()
  for (const { instructions } of stages) {
    for (const instruction of instructions) {
      if (!(instruction instanceof Run)) continue
      const runText = instruction
        .getArguments()
        .map((argument) => argument.getValue())
        .join(' ')
      for (const match of runText.matchAll(deployRegex)) {
        targetToFilter.set(match[2]!, match[1]!)
      }
    }
  }
  return targetToFilter
}

function matchCopyTarget(
  instructions: StageInstruction[],
  copySourcePrefix: string,
): string | undefined {
  for (const instruction of instructions) {
    if (!(instruction instanceof Copy)) continue
    if (!instruction.getFlags().some((flag) => flag.getName() === 'from')) continue
    const args = instruction.getArguments()
    if (args.at(-1)?.getValue() !== './') continue
    const [source] = args
    const sourcePath = source?.getValue()
    if (sourcePath?.startsWith(copySourcePrefix)) return sourcePath
  }
  return undefined
}

function matchCmdScriptPath(instructions: StageInstruction[]): string | undefined {
  const cmds = instructions.filter((instruction): instruction is Cmd => instruction instanceof Cmd)
  if (cmds.length === 0) return undefined

  const lastCmd = cmds.at(-1)!
  const parts = lastCmd.getJSONStrings()?.map((argument) => argument.getJSONValue())
  return parts?.at(-1)
}

function findWorkspaceDirByPackageName(monorepoRoot: string, packageName: string): string {
  const monorepoPackage = JSON.parse(readFileSync(path.join(monorepoRoot, 'package.json'), 'utf8'))
  const workspaces: string[] = Array.isArray(monorepoPackage.workspaces)
    ? monorepoPackage.workspaces
    : []

  for (const pattern of workspaces) {
    if (!pattern.includes('*')) {
      const dir = path.join(monorepoRoot, pattern)
      if (matchesPackage(dir, packageName)) return dir
      continue
    }

    const prefix = pattern.slice(0, pattern.indexOf('*'))
    const baseDir = path.join(monorepoRoot, prefix)
    if (!existsSync(baseDir)) continue
    for (const entry of readdirSafe(baseDir)) {
      const dir = path.join(baseDir, entry)
      if (matchesPackage(dir, packageName)) return dir
    }
  }

  throw new Error(`Workspace package not found for filter: ${packageName}`)
}

function matchesPackage(dir: string, packageName: string): boolean {
  const pkgPath = path.join(dir, 'package.json')
  if (!existsSync(pkgPath)) return false
  const { name } = JSON.parse(readFileSync(pkgPath, 'utf8'))
  return name === packageName
}

function readdirSafe(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory() ? [entry.name] : [],
    )
  } catch {
    return []
  }
}
