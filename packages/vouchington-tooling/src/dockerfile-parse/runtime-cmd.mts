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
  const targetToFilter = new Map<string, string>()
  for (const { stage, instructions } of stages) {
    for (const instruction of instructions) {
      if (!(instruction instanceof Run)) continue
      const runText = instruction
        .getArguments()
        .map((argument) => argument.getValue())
        .join(' ')
      for (const { filter, target } of parsePnpmDeploys(runText)) {
        targetToFilter.set(deployKey(stage, target), filter)
      }
    }
  }
  return targetToFilter
}

function parsePnpmDeploys(runText: string): { filter: string; target: string }[] {
  const found: { filter: string; target: string }[] = []
  for (const command of runText.split(/\s*(?:&&|;)\s*/)) {
    const parsed = parsePnpmDeploy(command)
    if (parsed) found.push(parsed)
  }
  return found
}

function parsePnpmDeploy(command: string): { filter: string; target: string } | undefined {
  const tokens = command.split(/\s+/).filter(Boolean)
  const pnpm = tokens.indexOf('pnpm')
  if (pnpm === -1) return undefined
  const deploy = tokens.indexOf('deploy', pnpm + 1)
  if (deploy === -1) return undefined
  const filter = flagValue(tokens, pnpm, tokens.length, 'filter')
  const prodTarget = flagValue(tokens, deploy + 1, tokens.length, 'prod')
  const positional = tokens[deploy + 1]
  const target =
    prodTarget ??
    (tokens.slice(pnpm, deploy).includes('--prod') && positional?.startsWith('/')
      ? positional
      : undefined)
  return filter && target ? { filter, target } : undefined
}

function flagValue(
  tokens: readonly string[],
  start: number,
  end: number,
  name: string,
): string | undefined {
  const flag = `--${name}`
  for (let index = start; index < end; index += 1) {
    const token = tokens[index]
    if (token === flag) return tokens[index + 1]
    if (token?.startsWith(`${flag}=`)) return token.slice(flag.length + 1)
  }
  return undefined
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
    if (args.at(-1)?.getValue() !== './' && args.at(-1)?.getValue() !== '.') continue
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
  if (packageName.startsWith('.') || packageName.startsWith('/')) {
    const dir = path.resolve(monorepoRoot, packageName)
    if (existsSync(path.join(dir, 'package.json'))) return dir
    throw new Error(`Workspace package not found for filter: ${packageName}`)
  }
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
