import {
  appendFileSync,
  chmodSync,
  closeSync,
  constants,
  fstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { basename, join } from 'node:path'

import { MAX_REVIEW_PAYLOAD_BYTES, ReviewPayloadError } from './payload.mts'

export type PayloadRequirement = 'optional' | 'required'

/** Reads a bounded regular file through an O_NOFOLLOW descriptor. */
export function readRegularReviewPayload(
  source: string,
  requirement: PayloadRequirement,
): Buffer | undefined {
  let descriptor: number
  try {
    descriptor = openSync(source, constants.O_RDONLY | constants.O_NOFOLLOW)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT' && requirement === 'optional') return undefined
    if (code === 'ENOENT') throw new ReviewPayloadError('Review payload is required.')
    if (code === 'ELOOP') {
      throw new ReviewPayloadError('Review payload must be a regular non-symlink file.')
    }
    throw error
  }

  try {
    const stat = fstatSync(descriptor)
    if (!stat.isFile()) {
      throw new ReviewPayloadError('Review payload must be a regular non-symlink file.')
    }
    if (stat.size === 0 || stat.size > MAX_REVIEW_PAYLOAD_BYTES) {
      throw new ReviewPayloadError(`Review payload must be 1..${MAX_REVIEW_PAYLOAD_BYTES} bytes.`)
    }
    const bytes = readFileSync(descriptor)
    if (bytes.length === 0 || bytes.length > MAX_REVIEW_PAYLOAD_BYTES) {
      throw new ReviewPayloadError(`Review payload must be 1..${MAX_REVIEW_PAYLOAD_BYTES} bytes.`)
    }
    return bytes
  } finally {
    closeSync(descriptor)
  }
}

/** Replaces a private staging directory and writes a 0600 payload from descriptor-read bytes. */
export function stageReviewPayload(
  source: string,
  destinationDirectory: string,
  requirement: PayloadRequirement,
): string | undefined {
  rmSync(destinationDirectory, { force: true, recursive: true })
  const bytes = readRegularReviewPayload(source, requirement)
  if (!bytes) return undefined

  mkdirSync(destinationDirectory, { recursive: true, mode: 0o700 })
  const destination = join(destinationDirectory, basename(source))
  writeFileSync(destination, bytes, { flag: 'wx', mode: 0o600 })
  chmodSync(destination, 0o600)
  return destination
}

/** Writes a single output value for a caller that exposes GitHub Actions outputs. */
export function writeStagedOutput(
  name: string,
  value: string,
  outputPath = process.env.GITHUB_OUTPUT,
): void {
  if (!outputPath) throw new ReviewPayloadError('GITHUB_OUTPUT is required.')
  if (!/^[A-Za-z_][A-Za-z0-9_-]*$/u.test(name)) {
    throw new ReviewPayloadError(
      'Output name must contain only letters, numbers, underscores, and hyphens.',
    )
  }
  if (/[\r\n]/u.test(value)) {
    throw new ReviewPayloadError('Output value must not contain CR or LF characters.')
  }
  appendFileSync(outputPath, `${name}=${value}\n`)
}
