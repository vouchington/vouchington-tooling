import { snapshotFixtureTimeouts, snapshotOptionsTimeout } from './fixture-timeout.mts'
import type { FixtureTimeoutGuard } from './fixture-timeout.mts'
import type {
  Fixtures,
  FullConfig,
  PlaywrightTestConfig,
  TestInfo,
  TestType,
  test as PlaywrightBase,
} from '@playwright/test'

export const DEFAULT_PLAYWRIGHT_TEST_TIMEOUT_MS = 30_000
export const DEFAULT_PLAYWRIGHT_TIMEOUT_GUARD_FIXTURE = 'playwrightTimeoutGuard'

export type PlaywrightTimeoutGuardOptions<
  Name extends string = typeof DEFAULT_PLAYWRIGHT_TIMEOUT_GUARD_FIXTURE,
> = {
  /** Largest test, hook, project, fixture, and suite timeout in milliseconds. Defaults to 30,000. */
  maxTimeoutMs?: number
  /** Name of the automatic guard fixture. Callers must not override it in `extend` or `use`. */
  fixtureName?: Name
}

type TimeoutInfo = Pick<TestInfo, 'timeout' | 'setTimeout' | 'slow'>

type DefaultFixtureName = typeof DEFAULT_PLAYWRIGHT_TIMEOUT_GUARD_FIXTURE

/** Without `fixtureName`, the guard registers and is typed by the default fixture name. */
export function createPlaywrightTimeoutGuard(
  options?: PlaywrightTimeoutGuardOptions,
): PlaywrightTimeoutGuard
/** A custom fixture name must be passed, so the guard's type always names the registered fixture. */
export function createPlaywrightTimeoutGuard<const Name extends string>(
  options: PlaywrightTimeoutGuardOptions<Name> & { fixtureName: Name },
): PlaywrightTimeoutGuard<Name>
export function createPlaywrightTimeoutGuard<Name extends string>(
  options: PlaywrightTimeoutGuardOptions<Name> = {},
): PlaywrightTimeoutGuard<Name> {
  // The overloads guarantee `Name` is the default name whenever `fixtureName` is omitted.
  const fixtureName = (options.fixtureName ?? DEFAULT_PLAYWRIGHT_TIMEOUT_GUARD_FIXTURE) as Name
  return buildTimeoutGuard(options.maxTimeoutMs ?? DEFAULT_PLAYWRIGHT_TEST_TIMEOUT_MS, fixtureName)
}

function buildTimeoutGuard<Name extends string>(maxTimeoutMs: number, fixtureName: Name) {
  if (!Number.isFinite(maxTimeoutMs) || maxTimeoutMs <= 0) {
    throw new RangeError(
      `Playwright timeout cap must be a positive finite number; got ${maxTimeoutMs}`,
    )
  }
  const capText = `${maxTimeoutMs.toLocaleString('en-US')} ms`
  const protectedInfo = new WeakSet<TimeoutInfo>()

  function testTimeout(timeout: unknown, label: string): number {
    if (
      typeof timeout !== 'number' ||
      !Number.isFinite(timeout) ||
      timeout <= 0 ||
      timeout > maxTimeoutMs
    ) {
      throw new RangeError(`${label} must be a positive finite number at most ${capText}`)
    }
    return timeout
  }
  const fixtureGuard: FixtureTimeoutGuard = { validate: testTimeout, fixtureName, capText }

  function validateConfigTimeouts(config: PlaywrightTestConfig): PlaywrightTestConfig {
    if (config.timeout !== undefined) testTimeout(config.timeout, 'Playwright test timeout')
    for (const project of config.projects ?? []) {
      if (project.timeout !== undefined) {
        testTimeout(project.timeout, `Playwright project ${project.name} timeout`)
      }
    }
    return config
  }

  function assertResolvedTimeouts(config: Pick<FullConfig, 'projects'>): void {
    for (const project of config.projects) {
      testTimeout(project.timeout, `Playwright project ${project.name} effective timeout`)
    }
  }

  function rejectSlow(): never {
    throw new RangeError(`Playwright slow modifiers are forbidden by the ${capText} test cap`)
  }

  function protectHookTimeouts(info: TimeoutInfo): void {
    if (protectedInfo.has(info)) return
    testTimeout(info.timeout, 'Playwright effective test timeout')
    const setTimeout = Reflect.get(info, 'setTimeout') as TestInfo['setTimeout']
    Object.defineProperties(info, {
      setTimeout: {
        writable: false,
        configurable: false,
        value: (timeout: number) =>
          Reflect.apply(setTimeout, info, [
            testTimeout(timeout, 'Playwright runtime test timeout'),
          ]),
      },
      slow: { value: rejectSlow, writable: false, configurable: false },
    })
    protectedInfo.add(info)
  }

  async function timeoutFixture(
    // oxlint-disable-next-line no-empty-pattern -- Playwright parses this public fixture dependency list.
    {}: object,
    use: () => Promise<void>,
    info: TestInfo,
  ): Promise<void> {
    protectHookTimeouts(info)
    await use()
  }

  function protectPublicMethods<T extends object, W extends object>(test: TestType<T, W>) {
    const setTimeout = Reflect.get(test, 'setTimeout') as TestType<T, W>['setTimeout']
    const extend = Reflect.get(test, 'extend') as TestType<T, W>['extend']
    const use = Reflect.get(test, 'use') as TestType<T, W>['use']
    const configure = Reflect.get(test.describe, 'configure') as TestType<
      T,
      W
    >['describe']['configure']
    Object.defineProperties(test, {
      beforeAll: { value: Reflect.get(test, 'beforeAll'), writable: false, configurable: false },
      afterAll: { value: Reflect.get(test, 'afterAll'), writable: false, configurable: false },
      info: { value: Reflect.get(test, 'info'), writable: false, configurable: false },
      setTimeout: {
        writable: false,
        configurable: false,
        value: (timeout: number) =>
          Reflect.apply(setTimeout, test, [testTimeout(timeout, 'Playwright public test timeout')]),
      },
      slow: { value: rejectSlow, writable: false, configurable: false },
      use: {
        writable: false,
        configurable: false,
        value: (fixtures: Parameters<typeof use>[0]): unknown =>
          Reflect.apply(use, test, [snapshotFixtureTimeouts(fixtures, fixtureGuard)]),
      },
      extend: {
        writable: false,
        configurable: false,
        value: (fixtures: Parameters<typeof extend>[0]) =>
          protectPublicMethods(
            Reflect.apply(extend, test, [
              snapshotFixtureTimeouts(fixtures, fixtureGuard),
            ]) as ReturnType<typeof extend>,
          ),
      },
    })
    Object.defineProperty(test.describe, 'configure', {
      writable: false,
      configurable: false,
      value: (options: Parameters<typeof configure>[0]): unknown =>
        Reflect.apply(configure, test.describe, [
          snapshotOptionsTimeout(options, testTimeout, 'Playwright suite test timeout'),
        ]),
    })
    return test
  }

  // `base` must be Playwright's own `test` or another test with no fixture timeout options: the
  // public API cannot enumerate fixtures inherited from a prior `extend`, so those are not validated.
  function guardTestTimeouts(base: typeof PlaywrightBase) {
    const guards = { [fixtureName]: [timeoutFixture, { auto: true }] }
    return protectPublicMethods(base.extend(guards as Fixtures<Record<Name, void>>))
  }

  return {
    maxTimeoutMs,
    fixtureName,
    testTimeout,
    validateConfigTimeouts,
    assertResolvedTimeouts,
    protectHookTimeouts,
    timeoutFixture,
    guardTestTimeouts,
  }
}

export type PlaywrightTimeoutGuard<Name extends string = DefaultFixtureName> = ReturnType<
  typeof buildTimeoutGuard<Name>
>
