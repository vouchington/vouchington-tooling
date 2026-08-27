import { createHash } from 'node:crypto'

export function gitBlobSha(content: Buffer, objectIdLength: number): string {
  const algorithm = objectIdLength === 40 ? 'sha1' : 'sha256'
  return createHash(algorithm).update(`blob ${content.length}\0`).update(content).digest('hex')
}
