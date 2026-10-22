import { readFileSync } from 'node:fs'

export type LabelMetadata = { color: string; description: string }

/**
 * How label names map to GitHub label metadata. `labels` holds explicit entries; any other name
 * gets `defaultColor` and `defaultDescription` (`{name}` is replaced by the label name). A name
 * starting with one of `strictPrefixes` must have an explicit entry, or it is rejected.
 */
export type LabelPolicy = {
  labels: Readonly<Record<string, LabelMetadata>>
  defaultColor: string
  defaultDescription: string
  strictPrefixes: readonly string[]
}

export const DEFAULT_LABEL_POLICY: LabelPolicy = {
  labels: {},
  defaultColor: 'EDEDED',
  defaultDescription: 'Repository issue classification: {name}.',
  strictPrefixes: [],
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || value === '') {
    throw new Error(`${field} must be a non-empty string`)
  }
  return value
}

function parseEntries(input: unknown): Record<string, LabelMetadata> {
  if (input === undefined) return {}
  if (!isRecord(input)) throw new Error('labels must be an object')
  const labels: Record<string, LabelMetadata> = {}
  for (const [name, entry] of Object.entries(input)) {
    if (!isRecord(entry)) throw new Error(`labels.${name} must be an object`)
    labels[name] = {
      color: text(entry.color, `labels.${name}.color`),
      description: text(entry.description, `labels.${name}.description`),
    }
  }
  return labels
}

/** Validates a parsed JSON label policy; omitted fields fall back to `DEFAULT_LABEL_POLICY`. */
export function parseLabelPolicy(input: unknown): LabelPolicy {
  if (!isRecord(input)) throw new Error('label policy must be a JSON object')
  const prefixes = input.strictPrefixes ?? []
  if (!Array.isArray(prefixes) || prefixes.some((prefix) => typeof prefix !== 'string')) {
    throw new Error('strictPrefixes must be an array of strings')
  }
  return {
    labels: parseEntries(input.labels),
    defaultColor:
      input.defaultColor === undefined
        ? DEFAULT_LABEL_POLICY.defaultColor
        : text(input.defaultColor, 'defaultColor'),
    defaultDescription:
      input.defaultDescription === undefined
        ? DEFAULT_LABEL_POLICY.defaultDescription
        : text(input.defaultDescription, 'defaultDescription'),
    strictPrefixes: prefixes as string[],
  }
}

export function readLabelPolicyFile(path: string): LabelPolicy {
  return parseLabelPolicy(JSON.parse(readFileSync(path, 'utf8')))
}

/** Resolves a label's color and description, throwing for an unlisted strict-prefix label. */
export function labelMetadata(
  name: string,
  policy: LabelPolicy = DEFAULT_LABEL_POLICY,
): LabelMetadata {
  const explicit = Object.hasOwn(policy.labels, name) ? policy.labels[name] : undefined
  if (explicit) return explicit
  const prefix = policy.strictPrefixes.find((candidate) => name.startsWith(candidate))
  if (prefix !== undefined) throw new Error(`unsupported ${prefix} label: ${name}`)
  return {
    color: policy.defaultColor,
    description: policy.defaultDescription.replaceAll('{name}', name),
  }
}
