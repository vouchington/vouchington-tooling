import { readFile } from 'node:fs/promises'

export async function loadPostgresParser(caller: string) {
  const entry = import.meta.resolve('no-mistakes')
  const metadata: { version: string } = JSON.parse(
    await readFile(new URL('package.json', entry), 'utf8'),
  )
  const version = /^(\d+)\.(\d+)\.(\d+)(-[\w.-]+)?(?:\+[\w.-]+)?$/.exec(metadata.version)
  const major = Number(version?.[1])
  const minor = Number(version?.[2])
  const patch = Number(version?.[3])
  if (!version || (major === 0 && (minor < 81 || (minor === 81 && patch === 0 && version[4])))) {
    throw new Error(`${caller} requires no-mistakes >=0.81.0`)
  }
  return import('no-mistakes')
}
