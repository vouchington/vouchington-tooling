import { randomUUID } from 'node:crypto'

/**
 * Generate a short random suffix for unique-ID-style usage in Playwright tests.
 * Use this instead of `Date.now()`, which can collide between parallel workers
 * and which returns different values when called twice in the same test.
 *
 * The suffix is 12 lowercase hex characters (about 48 bits of entropy), which
 * is plenty for slug/title/hostname uniqueness while remaining short and
 * readable in CI logs and screenshots.
 *
 * Compute the suffix once per test and reuse it everywhere a related ID is
 * needed (slug, name, hostname, etc.) so all values stay consistent:
 *
 * ```ts
 * const suffix = randomSuffix()
 * await insertRecord(`Example ${suffix}`, `example-${suffix}`)
 * ```
 *
 * If a `beforeAll` hook seeds data shared by a `describe` block (or a whole
 * file), call `randomSuffix()` *inside* that hook, not at module/describe
 * scope. Playwright's `fullyParallel` scheduler can hand a worker a second
 * test from the same file, re-running `beforeAll` with module scope intact —
 * a suffix hoisted outside the hook stays the same across that re-entry and
 * produces the same slug/name twice, which throws on any unique column.
 * Assign it as the first statement of the hook so every entry mints a fresh value:
 *
 * ```ts
 * let suffix = ''
 * test.beforeAll(async () => {
 *   suffix = randomSuffix()
 *   await insertRecord(`Example ${suffix}`, `example-${suffix}`)
 * })
 * ```
 */
export function randomSuffix(): string {
  return randomUUID().replaceAll('-', '').slice(0, 12)
}
