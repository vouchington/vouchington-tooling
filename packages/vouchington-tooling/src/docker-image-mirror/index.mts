import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { parse } from 'yaml'

import {
  DEFAULT_MIRROR,
  dockerfileViolations,
  workflowImageViolations,
  type Document,
} from './images.mts'

export { DEFAULT_MIRROR, dockerfileViolations, workflowImageViolations } from './images.mts'
export type { Document } from './images.mts'

export interface DockerImageMirrorOptions {
  /** Registry host that images must come from instead of Docker Hub. Default `mirror.gcr.io`. */
  readonly mirror?: string
}

export function isDockerfilePath(path: string): boolean {
  return /(?:^|\/)(?:Dockerfile(?:\.[^/]+)?|[^/]+\.Dockerfile)$/u.test(path)
}

/**
 * Violations for tracked workflows, composite actions and Dockerfiles that pull from Docker Hub
 * instead of the mirror. A tracked workflow deleted from disk is skipped; an unreadable tracked
 * Dockerfile is an error.
 */
export function checkDockerImageMirrors(
  root: string,
  trackedFiles: readonly string[],
  options: DockerImageMirrorOptions = {},
): string[] {
  const mirror = options.mirror ?? DEFAULT_MIRROR
  const errors: string[] = []
  for (const path of trackedFiles) {
    const yaml =
      /^\.github\/workflows\/[^/]+\.ya?ml$/u.test(path) ||
      /^\.github\/actions\/(?:.+\/)?action\.ya?ml$/u.test(path)
    const dockerfile = isDockerfilePath(path)
    if (!yaml && !dockerfile) continue
    if (yaml && !existsSync(join(root, path))) continue
    const source = readFileSync(join(root, path), 'utf8')
    errors.push(
      ...(yaml
        ? workflowImageViolations(path, parse(source) as Document, mirror)
        : dockerfileViolations(path, source)),
    )
  }
  return errors
}
