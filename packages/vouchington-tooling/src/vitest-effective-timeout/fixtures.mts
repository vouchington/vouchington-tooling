export const EFFECTIVE_TIMEOUT_CASE = `import { readFile, writeFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('effective timeout admission', () => {
  it('runs its owned setup before the body', async () => {
    expect(await readFile(new URL('./setup-call.marker', import.meta.url), 'utf8')).toBe('called')
    await writeFile(new URL('./body.marker', import.meta.url), 'ran')
  })
})
`

export const EFFECTIVE_TIMEOUT_SETUP = `import { writeFileSync } from 'node:fs'

writeFileSync(new URL('./setup-import.marker', import.meta.url), 'imported')

export default function setup() {
  writeFileSync(new URL('./setup-call.marker', import.meta.url), 'called')
}
`
