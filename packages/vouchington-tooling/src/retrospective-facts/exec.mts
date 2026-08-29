import { spawn } from 'node:child_process'
import type { CommandExecutor, CommandResult } from './shared.mts'

export const shell: CommandExecutor = (command, args) =>
  new Promise((resolve) => {
    const child = spawn(command, args)
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (data: string) => {
      stdout += data
    })
    child.stderr.on('data', (data: string) => {
      stderr += data
    })
    child.on('close', (exitCode) => resolve({ ok: exitCode === 0, stdout, stderr, exitCode }))
    child.on('error', (error) =>
      resolve({ ok: false, stdout, stderr: error.message, exitCode: null }),
    )
  })

export function rawBlock(command: string, args: string[], result: CommandResult): string {
  return `$ ${command} ${args.join(' ')}\n${result.stdout}${result.stderr ? `${result.stdout ? '\n' : ''}stderr:\n${result.stderr}` : ''}\n\n`
}
