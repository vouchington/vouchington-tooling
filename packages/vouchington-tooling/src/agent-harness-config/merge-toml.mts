import { parse as parseToml } from 'smol-toml'
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
  const blank = prefix !== '' && !prefix.endsWith('\n\n') ? '\n' : ''
  return `${prefix}${blank}[${table}]\n${assignment}\n`
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

function tomlPatchValue(parsed: Record<string, unknown>, table: string, key: string): unknown {
  let current: unknown = parsed
  if (table !== '') {
    for (const segment of table.split('.')) {
      /* v8 ignore next 2 -- if `text` parsed, every ancestor of a dotted table header is
         guaranteed to be a table too, so a real TOML parser can never hand back a non-object
         mid-path here. */
      if (current === null || typeof current !== 'object' || Array.isArray(current))
        return undefined
      current = (current as Record<string, unknown>)[segment]
    }
  }
  /* v8 ignore next 2 -- assertValidToml only reaches a patch's table here once readTomlKey has
     already proven (as a match, or by forcing the write that creates it) that the table is a
     real nested object in this parsed document. */
  if (current === null || typeof current !== 'object' || Array.isArray(current)) return undefined
  return (current as Record<string, unknown>)[key]
}

function assertValidToml(text: string, patches: readonly TomlPatch[], path: string): void {
  let parsed: Record<string, unknown>
  try {
    parsed = parseToml(text) as Record<string, unknown>
  } catch (error) {
    throw new Error(
      `${path}: produced invalid TOML (${error instanceof Error ? error.message : String(error)})`,
    )
  }
  for (const patch of patches) {
    const value = tomlPatchValue(parsed, patch.table, patch.key)
    /* v8 ignore next 6 -- backstop for a formatTomlValue/parseToml encoding mismatch; formatTomlValue's
       JSON.stringify-based escaping is a valid TOML basic string in every case this module writes,
       so a real parser always reads back what we just wrote. */
    if (!sameValue(value, patch.value)) {
      const key = patch.table === '' ? patch.key : `${patch.table}.${patch.key}`
      throw new Error(
        `${path}: wrote ${key} but a real TOML parser reads back ${JSON.stringify(value)}`,
      )
    }
  }
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
  if (drifts.length > 0) assertValidToml(text, patches, path)
  return { drifts, text }
}
