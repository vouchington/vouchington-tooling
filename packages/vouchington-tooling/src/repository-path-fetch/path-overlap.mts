import * as nativePath from 'node:path'

interface PathOperations {
  isAbsolute(path: string): boolean
  relative(from: string, to: string): string
  sep: string
}

export function pathsOverlap(
  left: string,
  right: string,
  operations: PathOperations = nativePath,
): boolean {
  const leftIdentity = filesystemIdentity(left)
  const rightIdentity = filesystemIdentity(right)
  return (
    contains(leftIdentity, rightIdentity, operations) ||
    contains(rightIdentity, leftIdentity, operations)
  )
}

function contains(parent: string, candidate: string, operations: PathOperations): boolean {
  const child = operations.relative(parent, candidate)
  return (
    child === '' ||
    (!operations.isAbsolute(child) && child !== '..' && !child.startsWith(`..${operations.sep}`))
  )
}

function filesystemIdentity(value: string): string {
  return value.normalize('NFC').toLowerCase()
}
