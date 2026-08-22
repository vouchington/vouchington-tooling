import { Copy, DockerfileParser, Run } from 'dockerfile-ast'

import { collectStages, type StageInstruction } from './stages.mts'

export interface DockerfilePrewarmStage {
  stage: string
  // COPY source whose destination is the stage payload root (e.g. `/prod/worker-io`),
  // undefined when the stage has no such COPY.
  copySource: string | undefined
  // The `--port N` value the prewarm binary is told to monitor for readiness.
  monitoredPort: number | undefined
  // The prewarm port env var on the same RUN, undefined when unset.
  envPort: number | undefined
}

export interface ParseDockerfilePrewarmOptions {
  copySourcePrefix?: string
  prewarmBinary?: string
  prewarmPortEnv?: string
}

export function parseDockerfilePrewarmStages(
  dockerfile: string,
  {
    copySourcePrefix = '/prod/',
    prewarmBinary = 'node-prewarm',
    prewarmPortEnv = 'NODE_PREWARM_PORT',
  }: ParseDockerfilePrewarmOptions = {},
): DockerfilePrewarmStage[] {
  const parser = DockerfileParser.parse(dockerfile)
  const stages = collectStages(parser)

  const prewarmStages: DockerfilePrewarmStage[] = []
  for (const { stage, instructions } of stages) {
    const prewarmRun = instructions.find(
      (instruction): instruction is Run =>
        instruction instanceof Run && isPrewarmRun(instruction, prewarmBinary),
    )
    if (!prewarmRun) continue

    const args = runArguments(prewarmRun)
    prewarmStages.push({
      stage,
      copySource: matchCopySource(instructions, copySourcePrefix),
      monitoredPort: matchMonitoredPort(args),
      envPort: matchEnvPort(args, prewarmPortEnv),
    })
  }
  return prewarmStages
}

function runArguments(instruction: Run): string[] {
  return instruction.getArguments().map((argument) => argument.getValue())
}

function isPrewarmRun(instruction: Run, prewarmBinary: string): boolean {
  return runArguments(instruction).some(
    (argument) => argument === prewarmBinary || argument.startsWith(`${prewarmBinary}@`),
  )
}

function matchCopySource(
  instructions: StageInstruction[],
  copySourcePrefix: string,
): string | undefined {
  for (const instruction of instructions) {
    if (!(instruction instanceof Copy)) continue
    if (!instruction.getFlags().some((flag) => flag.getName() === 'from')) continue
    const args = instruction.getArguments()
    if (args.at(-1)?.getValue() !== './') continue
    const sourcePath = args[0]?.getValue()
    if (sourcePath?.startsWith(copySourcePrefix)) return sourcePath
  }
  return undefined
}

function matchMonitoredPort(args: string[]): number | undefined {
  const index = args.indexOf('--port')
  if (index === -1) return undefined
  const value = args[index + 1]
  return value !== undefined && /^\d+$/.test(value) ? Number(value) : undefined
}

function matchEnvPort(args: string[], prewarmPortEnv: string): number | undefined {
  const prefix = `${prewarmPortEnv}=`
  for (const argument of args) {
    if (!argument.startsWith(prefix)) continue
    const value = argument.slice(prefix.length)
    if (/^\d+$/.test(value)) return Number(value)
  }
  return undefined
}
