import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { parseCiLocalArgs } from './parse.mts'
import type {
  CiLocalCommand,
  CiLocalSpawn,
  CiLocalTarget,
  LineWriter,
  RunCiLocalOptions,
} from './types.mts'

export type {
  CiLocalCommand,
  CiLocalSpawn,
  CiLocalSpawnOptions,
  CiLocalSpawnResult,
  CiLocalTarget,
  LineWriter,
  ParsedCiLocalArgs,
  RunCiLocalOptions,
} from './types.mts'
export { parseCiLocalArgs } from './parse.mts'

const DEFAULT_USAGE = 'Usage: ci-local [--list] | <target> [--dry-run]'

export function assertWorkflowCommandDrift(
  targets: Record<string, CiLocalTarget>,
  rootDir = process.cwd(),
): void {
  for (const target of Object.values(targets)) {
    for (const command of target.commands) {
      if (!command.source) continue
      const { workflow: sourceWorkflow, contains } = command.source
      const workflow = readFileSync(path.join(rootDir, sourceWorkflow), 'utf8')
      const expectedCommands = Array.isArray(contains) ? contains : [contains]
      if (expectedCommands.every((expectedCommand) => workflow.includes(expectedCommand))) continue

      throw new Error(
        `ci-local drift: ${command.description} command was not found in ${command.source.workflow}`,
      )
    }
  }
}

function defaultSpawn(
  command: string,
  args: readonly string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; stdio: 'inherit' },
) {
  const result = spawnSync(command, [...args], options)
  return { error: result.error, status: result.status }
}

function writeLine(stream: LineWriter, line: string): void {
  stream.write(`${line}\n`)
}

function runCommand(
  command: CiLocalCommand,
  dryRun: boolean,
  cwd: string,
  spawn: CiLocalSpawn,
  stdout: LineWriter,
): number {
  const envPreview = Object.keys(command.env ?? {})
    .filter((key) => command.env?.[key] !== undefined)
    .join(',')
  const renderedCommand = envPreview
    ? `env ${envPreview} bash -c ${JSON.stringify(command.command)}`
    : command.command

  writeLine(stdout, `\n$ ${renderedCommand}`)
  if (dryRun) return 0

  const result = spawn('/bin/bash', ['-c', command.command], {
    cwd,
    env: {
      ...process.env,
      ...command.env,
    },
    stdio: 'inherit',
  })
  if (result.error) throw result.error
  return result.status ?? 1
}

export function runCiLocal({
  args,
  targets,
  cwd = process.cwd(),
  spawn = defaultSpawn,
  stdout = process.stdout,
  stderr = process.stderr,
  usage = DEFAULT_USAGE,
}: RunCiLocalOptions): number {
  try {
    const targetNames = Object.keys(targets)
    const parsed = parseCiLocalArgs(args, targetNames)
    if (parsed.help) {
      writeLine(stdout, usage)
      return 0
    }
    if (parsed.list || !parsed.target) {
      for (const [name, target] of Object.entries(targets)) {
        writeLine(stdout, `${name} - ${target.description}`)
      }
      return 0
    }

    const target = targets[parsed.target]!
    assertWorkflowCommandDrift({ [parsed.target]: target }, cwd)

    writeLine(stdout, `${parsed.target}: ${target.description}`)
    for (const command of target.commands) {
      const status = runCommand(command, parsed.dryRun, cwd, spawn, stdout)
      if (status !== 0) return status
    }
    return 0
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    stderr.write(`${message}\n`)
    return 1
  }
}
