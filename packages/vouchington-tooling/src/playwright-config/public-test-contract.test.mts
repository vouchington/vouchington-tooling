import { describe, expect, it } from 'vitest'
import type {
  PlaywrightTestArgs,
  PlaywrightTestOptions,
  PlaywrightWorkerArgs,
  PlaywrightWorkerOptions,
  TestInfo,
  TestType,
} from '@playwright/test'
import { runnablePlaywrightTest } from './index.mts'
import type {
  RunnablePlaywrightFixtures,
  RunnablePlaywrightTest,
  RunnablePlaywrightTestInfo,
} from './index.mts'

type BaseTest = TestType<
  PlaywrightTestArgs & PlaywrightTestOptions,
  PlaywrightWorkerArgs & PlaywrightWorkerOptions
>

// Compiler-only positive contract checks; never executed at runtime.
export function verifyPositivePlaywrightContract(
  subject: RunnablePlaywrightTest<
    PlaywrightTestArgs & PlaywrightTestOptions,
    PlaywrightWorkerArgs & PlaywrightWorkerOptions
  >,
): void {
  const extended = subject.extend<{ custom: string }, { workerCustom: number }>({
    custom: async ({ page }, use) => {
      await page.title()
      await use('ok')
    },
    workerCustom: [3, { scope: 'worker' }],
  })
  extended.extend({
    custom: [
      async ({ custom, workerCustom }, use, info) => {
        const title: string = info.title
        const workerValue: number = workerCustom
        await info.attach('contract', { body: title, contentType: 'text/plain' })
        info.annotations.push({ type: 'contract', description: title })
        const output: string = info.outputPath('contract.txt')
        const retry: number = info.retry
        void workerValue
        void output
        void retry
        await use(custom)
      },
      { scope: 'test', timeout: 1_000, title: 'existing test fixture', box: 'self' },
    ],
    workerCustom: [
      async ({ workerCustom }, use, workerInfo) => {
        const index: number = workerInfo.workerIndex
        void index
        await use(workerCustom)
      },
      { scope: 'worker', timeout: 1_000, title: 'existing worker fixture', box: true },
    ],
  })
  extended.extend<{ optionFixture: string }, { workerOption: number }>({
    optionFixture: [
      'default',
      { option: true, auto: false, scope: 'test', title: 'test option', box: true, timeout: 1_000 },
    ],
    workerOption: [
      1,
      {
        option: true,
        auto: false,
        scope: 'worker',
        title: 'worker option',
        box: 'self',
        timeout: 1_000,
      },
    ],
  })
  extended('positive', async ({ page, custom, workerCustom }) => {
    const text: string = custom
    const count: number = workerCustom
    await page.title()
    void text
    void count
  })
  extended('details', { tag: '@probe' }, async ({ custom }) => {
    const text: string = custom
    void text
  })
  extended.describe('suite', () => {})
  extended.describe(() => {})
  extended.describe('suite', { tag: '@probe' }, () => {})
  extended.describe.serial('serial', () => {})
  extended.describe.parallel('parallel', () => {})
  const twice = extended.extend<{ second: boolean }>({ second: true })
  twice('twice', async ({ custom, second, workerCustom }) => {
    const text: string = custom
    const flag: boolean = second
    const count: number = workerCustom
    void text
    void flag
    void count
  })

  subject.beforeEach(async ({ page }, info) => {
    await page.title()
    const title: string = info.title
    void title
  })
  subject.afterAll('cleanup', async ({ browserName }, info) => {
    const name: string = browserName
    const title: string = info.title
    void name
    void title
  })
  subject.extend({
    page: async ({ page }, use, info) => {
      const title: string = info.title
      await use(page)
      void title
    },
  })
  subject.only('focused', async ({ page }, info) => {
    await page.title()
    const title: string = info.title
    void title
  })
  subject.only('focused', { tag: '@probe' }, async ({ browserName: _browserName }, info) => {
    const title: string = info.title
    void title
  })
  subject.fail('expected failure', async ({ page }, info) => {
    await page.title()
    const title: string = info.title
    void title
  })
  subject.fail('expected failure', { tag: '@probe' }, async ({ page }, info) => {
    await page.title()
    const title: string = info.title
    void title
  })
  subject.fail(true, 'expected failure')
  subject.fail(({ browserName }) => browserName === 'chromium', 'conditional failure')
  subject.fail()
  subject.fail.only('focused failure', async ({ page }, info) => {
    await page.title()
    const title: string = info.title
    void title
  })
  subject.fail.only('focused failure', { tag: '@probe' }, async ({ page }, info) => {
    await page.title()
    const title: string = info.title
    void title
  })
}

type AssertAssignable<Target, _Source extends Target> = Target

export type VerifyReplacedMembers<T extends {}, W extends {}> = [
  AssertAssignable<RunnablePlaywrightTest<T, W>['only'], TestType<T, W>['only']>,
  AssertAssignable<RunnablePlaywrightTest<T, W>['fail'], TestType<T, W>['fail']>,
  AssertAssignable<RunnablePlaywrightTest<T, W>['use'], TestType<T, W>['use']>,
  AssertAssignable<RunnablePlaywrightTest<T, W>['info'], TestType<T, W>['info']>,
  AssertAssignable<RunnablePlaywrightTest<T, W>['beforeEach'], TestType<T, W>['beforeEach']>,
  AssertAssignable<RunnablePlaywrightTest<T, W>['afterEach'], TestType<T, W>['afterEach']>,
  AssertAssignable<RunnablePlaywrightTest<T, W>['beforeAll'], TestType<T, W>['beforeAll']>,
  AssertAssignable<RunnablePlaywrightTest<T, W>['afterAll'], TestType<T, W>['afterAll']>,
  AssertAssignable<RunnablePlaywrightTest<T, W>['describe'], TestType<T, W>['describe']>,
]

export function verifyPlaywrightExtension<T extends {}, W extends {}, A extends {}, B extends {}>(
  source: TestType<T, W>,
  fixtures: RunnablePlaywrightFixtures<A, B, T, W>,
) {
  const next = source.extend<A, B>(fixtures)
  const checked: Omit<RunnablePlaywrightTest<T & A, W & B>, 'extend'> = next
  return checked
}

// Compiler-only negative contract checks; removing any restriction fails typecheck.
export function verifyRejectedSkipTypes(
  subject: RunnablePlaywrightTest<
    PlaywrightTestArgs & PlaywrightTestOptions,
    PlaywrightWorkerArgs & PlaywrightWorkerOptions
  >,
): void {
  // @ts-expect-error no skip
  subject.skip('hidden', () => {})
  // @ts-expect-error no literal computed fixme
  subject['fixme'](true, 'hidden')
  subject.only('focused', async ({ browserName: _browserName }, info) => {
    // @ts-expect-error no only-body skip
    info.skip(true, 'hidden')
  })
  subject.fail('expected failure', async ({ browserName: _browserName }, info) => {
    // @ts-expect-error no fail-body skip
    info.skip(true, 'hidden')
  })
  subject.fail(
    'expected failure',
    { tag: '@probe' },
    async ({ browserName: _browserName }, info) => {
      // @ts-expect-error no fail-body fixme
      info.fixme(true, 'hidden')
    },
  )
  subject.fail.only('focused failure', async ({ browserName: _browserName }, info) => {
    // @ts-expect-error no fail.only-body skip
    info.skip(true, 'hidden')
  })
  subject.fail.only(
    'focused failure',
    { tag: '@probe' },
    async ({ browserName: _browserName }, info) => {
      // @ts-expect-error no fail.only-body fixme
      info.fixme(true, 'hidden')
    },
  )
  // @ts-expect-error no suite skip
  subject.describe.skip('suite', () => {})
  // @ts-expect-error no serial fixme
  subject.describe.serial['fixme']('suite', () => {})
  subject.only('focused', { tag: '@probe' }, async ({ browserName: _browserName }, info) => {
    // @ts-expect-error no only-body fixme
    info.fixme(true, 'hidden')
  })
  subject('body', async ({ browserName: _browserName }, info) => {
    // @ts-expect-error no body skip
    info.skip(true, 'hidden')
    // @ts-expect-error no destructured fixme
    const { fixme } = info
    void fixme
    // @ts-expect-error no raw TestInfo widening
    const raw: TestInfo = info
    void raw
  })
  // @ts-expect-error no info skip
  subject.info().skip(true, 'hidden')
  subject.use({
    page: async ({ page }, use, info) => {
      // @ts-expect-error no use fixture skip
      info.skip(true, 'hidden')
      await use(page)
    },
  })
  const negativeExtended = subject.extend<{ custom: string }>({
    custom: async ({ browserName: _browserName }, use, info) => {
      // @ts-expect-error no fixture fixme
      info.fixme(true, 'hidden')
      await use('ok')
    },
  })
  // @ts-expect-error no extended skip
  negativeExtended.skip('hidden', () => {})
  // @ts-expect-error no twice extended fixme
  negativeExtended.extend<{ second: boolean }>({ second: true }).fixme('hidden', () => {})
  subject.beforeEach(async ({ browserName: _browserName }, info) => {
    // @ts-expect-error no beforeEach skip
    info.skip(true, 'hidden')
  })
  subject.afterEach(async ({ browserName: _browserName }, info) => {
    // @ts-expect-error no afterEach fixme
    info.fixme(true, 'hidden')
  })
  subject.beforeAll(async ({ browserName: _browserName }, info) => {
    // @ts-expect-error no beforeAll skip
    info.skip(true, 'hidden')
  })
  subject.afterAll(async ({ browserName: _browserName }, info) => {
    // @ts-expect-error no afterAll fixme
    info.fixme(true, 'hidden')
  })
  subject.use({
    // @ts-expect-error explicit raw TestInfo fixture callback is incompatible
    page: async ({ page }, use, info: TestInfo) => {
      await use(page)
      void info
    },
  })
  // @ts-expect-error public test cannot be widened into unrestricted TestType
  const rawTest: BaseTest = subject
  void rawTest
}

describe('runnablePlaywrightTest contract', () => {
  it('returns the same callable test reference with skip/fixme removed from its type', () => {
    const source = {} as BaseTest
    const projected = runnablePlaywrightTest(source)
    const info: RunnablePlaywrightTestInfo = { title: 't' } as RunnablePlaywrightTestInfo
    expect(projected).toBe(source)
    expect(info.title).toBe('t')
  })
})
