import { USAGE } from './usage-text.mts'

export { USAGE }

export function printUsage(stream: NodeJS.WritableStream = process.stdout): void {
  stream.write(USAGE)
}

export function commandNames(usage = USAGE): string[] {
  const names: string[] = []
  let inCommands = false
  for (const line of usage.split('\n')) {
    if (line === 'Commands:') {
      inCommands = true
      continue
    }
    if (!inCommands) continue
    if (line === '') break
    const name = line.trim().split(/\s+/)[0]
    if (name) names.push(name)
  }
  return names
}

export function commandUsage(command: string, usage = USAGE): string {
  const names = new Set(commandNames(usage))
  if (!names.has(command)) throw new Error(`unknown command: ${command}`)
  const lines = usage.split('\n')
  const detailStart = lines.indexOf('Options:')
  const selected: string[] = []
  let capturing = false
  for (const line of lines.slice(detailStart + 1)) {
    if (line === '') {
      if (capturing) break
      continue
    }
    if (!line.startsWith(' ')) capturing = line.trim().split(/\s+/)[0] === command
    if (capturing) selected.push(line)
  }
  if (selected.length === 0) throw new Error(`no usage for ${command}`)
  return `${selected.join('\n')}\n`
}
