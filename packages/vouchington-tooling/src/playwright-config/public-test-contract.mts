import type { Fixtures, TestFixture, TestInfo, TestType, WorkerFixture } from '@playwright/test'

export type RunnablePlaywrightTestInfo = Omit<TestInfo, 'skip' | 'fixme'>

// Public test/hook callbacks expose TestInfo in their second argument. Fixture callbacks use
// their third argument. Preserve the remaining argument and return types exactly.
type RunnableCallback<Value> = Value extends (...args: infer Args) => infer Result
  ? Args extends [infer First, infer Second, infer Info]
    ? Info extends TestInfo
      ? (first: First, second: Second, info: RunnablePlaywrightTestInfo) => Result
      : Value
    : Args extends [infer First, infer Info]
      ? Info extends TestInfo
        ? (first: First, info: RunnablePlaywrightTestInfo) => Result
        : Value
      : Value
  : Value

// Current public test APIs have at most five call overloads (test.fail has six). Compiler
// contracts exercise each supported overload and check the source member independently.
type RunnableCalls<Callable> = Callable extends {
  (...args: infer First): infer FirstResult
  (...args: infer Second): infer SecondResult
  (...args: infer Third): infer ThirdResult
  (...args: infer Fourth): infer FourthResult
  (...args: infer Fifth): infer FifthResult
}
  ? {
      (...args: { [Key in keyof First]: RunnableCallback<First[Key]> }): FirstResult
      (...args: { [Key in keyof Second]: RunnableCallback<Second[Key]> }): SecondResult
      (...args: { [Key in keyof Third]: RunnableCallback<Third[Key]> }): ThirdResult
      (...args: { [Key in keyof Fourth]: RunnableCallback<Fourth[Key]> }): FourthResult
      (...args: { [Key in keyof Fifth]: RunnableCallback<Fifth[Key]> }): FifthResult
    }
  : never

// Playwright 1.65 added test.fail(description), so it has six call overloads.
type RunnableSixCalls<Callable> = Callable extends {
  (...args: infer First): infer FirstResult
  (...args: infer Second): infer SecondResult
  (...args: infer Third): infer ThirdResult
  (...args: infer Fourth): infer FourthResult
  (...args: infer Fifth): infer FifthResult
  (...args: infer Sixth): infer SixthResult
}
  ? {
      (...args: { [Key in keyof First]: RunnableCallback<First[Key]> }): FirstResult
      (...args: { [Key in keyof Second]: RunnableCallback<Second[Key]> }): SecondResult
      (...args: { [Key in keyof Third]: RunnableCallback<Third[Key]> }): ThirdResult
      (...args: { [Key in keyof Fourth]: RunnableCallback<Fourth[Key]> }): FourthResult
      (...args: { [Key in keyof Fifth]: RunnableCallback<Fifth[Key]> }): FifthResult
      (...args: { [Key in keyof Sixth]: RunnableCallback<Sixth[Key]> }): SixthResult
    }
  : never

type RunnableDescribe<Describe> = RunnableCalls<Describe> &
  Omit<Describe, 'skip' | 'fixme' | 'serial' | 'parallel'> & {
    serial: Describe extends { serial: infer Serial }
      ? RunnableCalls<Serial> & Omit<Serial, 'skip' | 'fixme'>
      : never
    parallel: Describe extends { parallel: infer Parallel }
      ? RunnableCalls<Parallel> & Omit<Parallel, 'skip' | 'fixme'>
      : never
  }

// Match public Fixtures' exclusion of callable fixture values; this is not a callable API.
// oxlint-disable-next-line typescript/no-unsafe-function-type -- Preserve Playwright's exact generic fixture-data partition.
type FixtureConstant<Value> = Exclude<Value, Function>

type TestValue<Value, Args extends {}> =
  | FixtureConstant<Value>
  | ((
      args: Args,
      use: (value: Value) => Promise<void>,
      info: RunnablePlaywrightTestInfo,
    ) => ReturnType<TestFixture<Value, Args>>)
type WorkerValue<Value, Args extends {}> = FixtureConstant<Value> | WorkerFixture<Value, Args>
type TupleOptions<Value> = Extract<NonNullable<Value>, readonly unknown[]>[1]
type NewTestOptions = TupleOptions<Fixtures<{ value: string }>['value']>
type ExistingTestOptions = TupleOptions<Fixtures<{}, {}, { value: string }>['value']>
type NewWorkerOptions = TupleOptions<Fixtures<{}, { value: string }>['value']>
type ExistingWorkerOptions = TupleOptions<Fixtures<{}, {}, {}, { value: string }>['value']>

// Keep Playwright's four key partitions: worker/test overrides and new worker/test fixtures.
// Derive tuple options from public Fixtures so upstream option additions remain available.
export type RunnablePlaywrightFixtures<
  Tests extends {},
  Workers extends {},
  ParentTests extends {},
  ParentWorkers extends {},
> = {
  [Key in keyof ParentWorkers]?:
    | WorkerValue<ParentWorkers[Key], Workers & ParentWorkers>
    | [WorkerValue<ParentWorkers[Key], Workers & ParentWorkers>, ExistingWorkerOptions]
} & {
  [Key in keyof ParentTests]?:
    | TestValue<ParentTests[Key], Tests & Workers & ParentTests & ParentWorkers>
    | [
        TestValue<ParentTests[Key], Tests & Workers & ParentTests & ParentWorkers>,
        ExistingTestOptions,
      ]
} & {
  [Key in Exclude<keyof Workers, keyof ParentWorkers | keyof ParentTests>]?: [
    WorkerValue<Workers[Key], Workers & ParentWorkers>,
    NewWorkerOptions,
  ]
} & {
  [Key in Exclude<keyof Tests, keyof ParentWorkers | keyof ParentTests>]?:
    | TestValue<Tests[Key], Tests & Workers & ParentTests & ParentWorkers>
    | [TestValue<Tests[Key], Tests & Workers & ParentTests & ParentWorkers>, NewTestOptions]
}

type ReplacedMembers =
  | 'skip'
  | 'fixme'
  | 'describe'
  | 'extend'
  | 'info'
  | 'use'
  | 'only'
  | 'fail'
  | 'beforeEach'
  | 'afterEach'
  | 'beforeAll'
  | 'afterAll'

export type RunnablePlaywrightTest<Tests extends {}, Workers extends {}> = RunnableCalls<
  TestType<Tests, Workers>
> &
  Omit<TestType<Tests, Workers>, ReplacedMembers> & {
    only: RunnableCalls<TestType<Tests, Workers>['only']>
    fail: RunnableSixCalls<TestType<Tests, Workers>['fail']> & {
      only: RunnableCalls<TestType<Tests, Workers>['fail']['only']>
    }
    beforeEach: RunnableCalls<TestType<Tests, Workers>['beforeEach']>
    afterEach: RunnableCalls<TestType<Tests, Workers>['afterEach']>
    beforeAll: RunnableCalls<TestType<Tests, Workers>['beforeAll']>
    afterAll: RunnableCalls<TestType<Tests, Workers>['afterAll']>
    info: () => RunnablePlaywrightTestInfo
    describe: RunnableDescribe<TestType<Tests, Workers>['describe']>
    use(fixtures: RunnablePlaywrightFixtures<{}, {}, Tests, Workers>): void
    extend<MoreTests extends {}, MoreWorkers extends {} = {}>(
      fixtures: RunnablePlaywrightFixtures<MoreTests, MoreWorkers, Tests, Workers>,
    ): RunnablePlaywrightTest<Tests & MoreTests, Workers & MoreWorkers>
  }

export function runnablePlaywrightTest<Tests extends {}, Workers extends {}>(
  source: TestType<Tests, Workers>,
): RunnablePlaywrightTest<Tests, Workers> {
  // This projection retains the same callable object and its protected timeout descriptors.
  // TypeScript cannot compare the complete recursive extend/use fixture relationship. The
  // compiler contracts independently check every replaced member and an explicitly instantiated
  // extension's complete nonrecursive surface. No new runtime capability is promised: only
  // whole-test skip methods and their TestInfo counterparts disappear from the public types.
  // .only remains available for local debugging; CI forbidOnly owns focus. Step skips remain.
  return source as RunnablePlaywrightTest<Tests, Workers>
}
