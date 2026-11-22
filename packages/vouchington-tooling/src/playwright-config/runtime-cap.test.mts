import { describe, expect, it } from 'vitest'
import { capError, FIXTURE_NAME, runFixture } from './runtime-fixture.test-helpers.mts'

describe('Playwright public timeout runtime', () => {
  it.each([
    ['computed test setter', `test['set' + 'Timeout'](30001)`],
    ['zero test setter', 'test.setTimeout(0)'],
    ['infinite test setter', 'test.setTimeout(Infinity)'],
    ['info setter', 'info.setTimeout(30001)'],
    ['computed info setter', `info['set' + 'Timeout'](0)`],
    ['aliased test setter', 'const setter = test.setTimeout; setter(30001)'],
    ['bound info setter', 'const setter = info.setTimeout.bind(info); setter(30001)'],
    ['replacement test setter', 'test.setTimeout = () => {}; test.setTimeout(30001)'],
    ['replacement slow', 'test.slow = () => {}; test.slow()'],
    ['test.info instance', 'test.info().setTimeout(30001)'],
    ['test slow', 'test.slow()'],
    ['info slow', 'info.slow()'],
    ['replacement info setter', 'info.setTimeout = () => {}; info.setTimeout(30001)'],
  ])('rejects %s before continuing the body', async (name, body) => {
    const result = await runFixture(body)
    expect(result.code).toBe(1)
    expect(result.stats?.unexpected).toBe(1)
    expect(result.output).toMatch(
      name.startsWith('replacement') ? /read only|Cannot assign/ : capError,
    )
    expect(result.marker).toBeUndefined()
  })

  it.each([
    ['setter', 'info.setTimeout(30001)'],
    ['slow', 'info.slow()'],
    ['aliased setter', 'const setter = info.setTimeout.bind(info); setter(0)'],
  ])('installs the info guard before beforeEach %s', async (_name, hook) => {
    const result = await runFixture('', {
      collection: `test.beforeEach(async ({}, info) => { ${hook} })`,
    })
    expect(result.code).toBe(1)
    expect(result.stats?.unexpected).toBe(1)
    expect(result.output).toMatch(capError)
    expect(result.marker).toBeUndefined()
  })

  it.each([
    ['descendant setter', `const child = test.extend({}); child.setTimeout(30001)`],
    ['descendant slow', `const child = test.extend({}); child.slow()`],
    ['suite setter', `const configure = test.describe.configure; configure({ timeout: 30001 })`],
    ['collection slow', 'test.slow()'],
    ['extend guard replacement', `test.extend({ ${FIXTURE_NAME}: undefined })`],
    ['use guard replacement', `test.use({ ${FIXTURE_NAME}: undefined })`],
    [
      'test fixture tuple ceiling',
      `test.extend({ sample: [async ({}, use) => await use('fixture'), { timeout: 30001 }] })`,
    ],
    [
      'worker fixture tuple ceiling',
      `test.extend({ sample: [async ({}, use) => await use('fixture'), { scope: 'worker', timeout: 30001 }] })`,
    ],
    [
      'computed fixture tuple ceiling',
      `const budget = 30000 + 1; const options = { ['time' + 'out']: budget }; test.extend({ sample: [async ({}, use) => await use('fixture'), options] })`,
    ],
    [
      'zero fixture tuple deadline',
      `test.extend({ sample: [async ({}, use) => await use('fixture'), { timeout: 0 }] })`,
    ],
    [
      'use fixture tuple ceiling',
      `test.use({ sample: [async ({}, use) => await use('fixture'), { timeout: 30001 }] })`,
    ],
  ])('rejects %s during collection', async (_name, collection) => {
    const result = await runFixture('', { collection })
    expect(result.code).toBe(1)
    expect(result.output).toMatch(capError)
    expect(result.marker).toBeUndefined()
  })

  it.each(['0', 'Infinity', '30001'])(
    'rejects resolved CLI timeout %s before body',
    async (cliTimeout) => {
      const result = await runFixture('', { cliTimeout })
      expect(result.code).toBe(1)
      expect(result.output).toMatch(/positive finite number at most 30,000 ms|timeout.*number/i)
      expect(result.marker).toBeUndefined()
    },
  )

  it.each([
    ['extended computed setter', `test['set' + 'Timeout'](30001)`],
    ['extended info setter', 'info.setTimeout(30001)'],
    ['extended slow', 'test.slow()'],
  ])('rejects %s in an inherited automatic fixture', async (_name, body) => {
    const result = await runFixture(body, { extended: true })
    expect(result.code).toBe(1)
    expect(result.stats?.unexpected).toBe(1)
    expect(result.output).toMatch(capError)
    expect(result.marker).toBeUndefined()
  })
})
