import { spawn } from 'node:child_process'
import type { CommandExecutor, CommandResult } from './shared.mts'

export const shell: CommandExecutor = (command, args) =>
  new Promise((resolve) => {
    const child = spawn(command, args)
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (data: Buffer) => {
      stdout += data
    })
    child.stderr.on('data', (data: Buffer) => {
      stderr += data
    })
    child.on('close', (code) => resolve({ ok: code === 0, stdout, stderr }))
    child.on('error', (error) => resolve({ ok: false, stdout, stderr: error.message }))
  })

export function rawBlock(command: string, args: string[], result: CommandResult): string {
  return `$ ${command} ${args.join(' ')}\n${result.stdout}${result.stderr ? `${result.stdout ? '\n' : ''}stderr:\n${result.stderr}` : ''}\n\n`
}
