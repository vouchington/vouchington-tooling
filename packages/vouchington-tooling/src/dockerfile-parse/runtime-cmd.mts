import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { Cmd, Copy, DockerfileParser, Run } from 'dockerfile-ast'

import { expandWorkspaceGlob } from '../workspace-glob.mts'
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

const CMD_SCRIPT = /\.(?:[cm]?[jt]s|tsx)$/u

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

    const pnpmFilter = targetToFilter.get(deployKey(target.fromStage, target.sourcePath))
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

function deployKey(stage: string, target: string): string {
  return `${stage}\0${target}`
}

function collectDeployTargets(
  stages: readonly { stage: string; instructions: StageInstruction[] }[],
): Map<string, string> {
  const deployRegex =
    /pnpm(?:\s+--?\S+(?:\s+(?!deploy\b)\S+)?)*\s+deploy\s+--filter\s+(\S+)\s+--prod\s+(\/\S+)/g
  const targetToFilter = new Map<string, string>()
  for (const { stage, instructions } of stages) {
    for (const instruction of instructions) {
      if (!(instruction instanceof Run)) continue
      const runText = instruction
        .getArguments()
        .map((argument) => argument.getValue())
        .join(' ')
      for (const match of runText.matchAll(deployRegex)) {
        targetToFilter.set(deployKey(stage, match[2]!), match[1]!)
      }
    }
  }
  return targetToFilter
}

function matchCopyTarget(
  instructions: StageInstruction[],
  copySourcePrefix: string,
): { fromStage: string; sourcePath: string } | undefined {
  for (const instruction of instructions) {
    if (!(instruction instanceof Copy)) continue
    const fromStage = instruction
      .getFlags()
      .find((flag) => flag.getName() === 'from')
      ?.getValue()
    if (!fromStage) continue
    const args = instruction.getArguments()
    if (args.at(-1)?.getValue() !== './') continue
    const sourcePath = args[0]?.getValue()
    if (sourcePath?.startsWith(copySourcePrefix)) return { fromStage, sourcePath }
  }
  return undefined
}

function matchCmdScriptPath(instructions: StageInstruction[]): string | undefined {
  const cmds = instructions.filter((instruction): instruction is Cmd => instruction instanceof Cmd)
  if (cmds.length === 0) return undefined

  const parts = cmds
    .at(-1)!
    .getJSONStrings()
    ?.map((argument) => argument.getJSONValue())
  return parts?.find((part) => CMD_SCRIPT.test(part))
}

function findWorkspaceDirByPackageName(monorepoRoot: string, packageName: string): string {
  const monorepoPackage = JSON.parse(readFileSync(path.join(monorepoRoot, 'package.json'), 'utf8'))
  const workspaces: string[] = Array.isArray(monorepoPackage.workspaces)
    ? monorepoPackage.workspaces
    : []

  for (const pattern of workspaces) {
    for (const dir of expandWorkspaceGlob(monorepoRoot, pattern)) {
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
