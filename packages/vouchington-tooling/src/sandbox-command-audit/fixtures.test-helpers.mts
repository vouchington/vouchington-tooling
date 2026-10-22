import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach } from 'vitest'
import { resolveLimits, type AuditLimits } from './limits.mts'

export const limits = (overrides: Partial<AuditLimits> = {}): AuditLimits =>
  resolveLimits(overrides)

export const jsonl = (...records: unknown[]): string[] =>
  records.map((record) => JSON.stringify(record))

export function bashUse(id: string, command: string, input: Record<string, unknown> = {}) {
  return {
    type: 'assistant',
    message: {
      content: [{ type: 'tool_use', id, name: 'Bash', input: { command, ...input } }],
    },
  }
}

export function toolResult(
  id: string,
  content: unknown,
  extra: { isError?: boolean; toolDenialKind?: string } = {},
) {
  const { isError = true, toolDenialKind } = extra
  return {
    type: 'user',
    ...(toolDenialKind === undefined ? {} : { toolDenialKind }),
    message: {
      content: [{ type: 'tool_result', tool_use_id: id, is_error: isError, content }],
    },
  }
}

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** A temporary directory removed after the test. */
export function tempDir(): string {
  const root = mkdtempSync(join(tmpdir(), 'sandbox-audit-test-'))
  roots.push(root)
  return root
}

export function writeLines(path: string, lines: string[]): string {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${lines.join('\n')}\n`)
  return path
}
