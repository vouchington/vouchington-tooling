import { sameValue } from './policy.mts'
import { formatTomlValue, parseTomlValue } from './toml-value.mts'
import type { KeyDrift, TomlPatch, TomlValue } from './types.mts'

function lineStarts(text: string): number[] {
  const starts = [0]
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '\n') starts.push(index + 1)
  }
  return starts
}

function lineAt(text: string, start: number): string {
  const end = text.indexOf('\n', start)
  return text.slice(start, end === -1 ? text.length : end)
}

function isHeaderLine(line: string): boolean {
  return line.trimStart().startsWith('[')
}

function headerName(line: string): string | undefined {
  const trimmed = line.trim()
  if (trimmed.startsWith('[[') || !trimmed.startsWith('[')) return undefined
  const close = trimmed.indexOf(']')
  if (close <= 1) return undefined
  return trimmed.slice(1, close)
}

function tableRange(text: string, table: string): { bodyEnd: number; bodyStart: number } {
  const starts = lineStarts(text)
  if (table === '') {
    const first = starts.find((start) => isHeaderLine(lineAt(text, start)))
    return { bodyEnd: first ?? text.length, bodyStart: 0 }
  }
  for (const start of starts) {
    const line = lineAt(text, start)
    if (headerName(line) !== table) continue
    const bodyStart = start + line.length + (text[start + line.length] === '\n' ? 1 : 0)
    const next = starts.find(
      (candidate) => candidate >= bodyStart && isHeaderLine(lineAt(text, candidate)),
    )
    return { bodyEnd: next ?? text.length, bodyStart }
  }
  return { bodyEnd: -1, bodyStart: -1 }
}

function keyMatch(text: string, bodyStart: number, bodyEnd: number, key: string) {
  const pattern = new RegExp(
    `^[ \\t]*${key.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')}[ \\t]*=[ \\t]*`,
    'm',
  )
  const slice = text.slice(bodyStart, bodyEnd)
  const match = pattern.exec(slice)
  if (!match || match.index === undefined) return undefined
  const equals = bodyStart + match.index + match[0].length
  return { equals, parsed: parseTomlValue(text, equals) }
}

export function readTomlKey(text: string, table: string, key: string): unknown {
  const range = tableRange(text, table)
  if (range.bodyStart < 0) return undefined
  return keyMatch(text, range.bodyStart, range.bodyEnd, key)?.parsed.value
}

function appendTable(text: string, table: string, assignment: string): string {
  const prefix = text === '' || text.endsWith('\n') ? text : `${text}\n`
  const header = table === '' ? '' : `[${table}]\n`
  const blank = prefix !== '' && table !== '' && !prefix.endsWith('\n\n') ? '\n' : ''
  return `${prefix}${blank}${header}${assignment}\n`
}

function upsertTomlKey(text: string, table: string, key: string, value: TomlValue): string {
  const assignment = `${key} = ${formatTomlValue(value)}`
  const range = tableRange(text, table)
  if (range.bodyStart < 0) return appendTable(text, table, assignment)
  const existing = keyMatch(text, range.bodyStart, range.bodyEnd, key)
  if (existing) {
    return `${text.slice(0, existing.equals)}${formatTomlValue(value)}${text.slice(existing.parsed.end)}`
  }
  const at = range.bodyEnd
  const prefix = at > 0 && text[at - 1] !== '\n' ? '\n' : ''
  return `${text.slice(0, at)}${prefix}${assignment}\n${text.slice(at)}`
}

export function applyTomlPatches(
  source: string,
  patches: readonly TomlPatch[],
  path: string,
): { drifts: KeyDrift[]; text: string } {
  const drifts: KeyDrift[] = []
  let text = source.replaceAll('\r\n', '\n')
  for (const patch of patches) {
    const current = readTomlKey(text, patch.table, patch.key)
    if (sameValue(current, patch.value)) continue
    const key = patch.table === '' ? patch.key : `${patch.table}.${patch.key}`
    drifts.push({ current, desired: patch.value, key, path })
    text = upsertTomlKey(text, patch.table, patch.key, patch.value)
  }
  return { drifts, text }
}
