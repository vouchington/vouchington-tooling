import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { SharedContext } from '../shared-context/index.mts'
import {
  AWS_EVENT_ACCOUNT_RE,
  AWS_EVENT_DISCRIMINATOR_RE,
  DEFAULT_EXCLUDED_PATH_RE,
  DEFAULT_PATTERNS,
  type LiteralPattern,
} from './patterns.mts'
import { findS3LocationOffsets } from './s3.mts'

export interface PublicSourceLiteralsOptions {
  /** Repo-specific patterns checked in addition to the built-in generic ones. */
  extraPatterns?: readonly LiteralPattern[]
  /** Extra S3 bucket names (compared case-insensitively) that are placeholders, not deployments. */
  allowedS3Buckets?: readonly string[]
  /** Extra tracked-file path patterns to skip, in addition to node_modules, vendor, dist, coverage. */
  ignorePaths?: readonly RegExp[]
}

function lineAt(content: string, index: number | undefined): number {
  return content.slice(0, index).split('\n').length
}

function report(errors: string[], file: string, line: number, category: string): void {
  errors.push(
    `::error file=${file},line=${line}::public source literal guard: ${category} must be injected, generic, or private`,
  )
}

function readText(ctx: SharedContext, file: string): string | null {
  if (ctx.readTrackedFile) return ctx.readTrackedFile(file)
  try {
    return readFileSync(join(ctx.repoRoot, file), 'utf8')
  } catch {
    return null
  }
}

export async function checkPublicSourceLiterals(
  ctx: SharedContext,
  options: PublicSourceLiteralsOptions = {},
): Promise<{ errors: string[] }> {
  const errors: string[] = []
  if (!ctx.isInsideGitRepo) return { errors }
  const patterns = [...DEFAULT_PATTERNS, ...(options.extraPatterns ?? [])]
  // Strip g/y so a stateful lastIndex cannot make matching depend on earlier files.
  const ignorePaths = (options.ignorePaths ?? []).map(
    (re) => new RegExp(re.source, re.flags.replace(/[gy]/g, '')),
  )
  const allowedBuckets = new Set((options.allowedS3Buckets ?? []).map((b) => b.toLowerCase()))
  for (const file of ctx.trackedFiles) {
    if (DEFAULT_EXCLUDED_PATH_RE.test(file) || ignorePaths.some((re) => re.test(file))) continue
    const content = readText(ctx, file)
    if (content === null || content.includes('\0')) continue
    for (const pattern of patterns) {
      if (pattern.appliesTo !== undefined && !pattern.appliesTo(file)) continue
      const flags = pattern.expression.flags.replace('g', '')
      for (const match of content.matchAll(new RegExp(pattern.expression.source, `${flags}g`))) {
        report(errors, file, lineAt(content, match.index), pattern.category)
      }
    }
    if (AWS_EVENT_DISCRIMINATOR_RE.test(content)) {
      for (const match of content.matchAll(AWS_EVENT_ACCOUNT_RE))
        report(errors, file, lineAt(content, match.index), 'AWS account identifier')
    }
    for (const offset of findS3LocationOffsets(content, allowedBuckets))
      report(errors, file, lineAt(content, offset), 'S3 location')
  }
  return { errors }
}
