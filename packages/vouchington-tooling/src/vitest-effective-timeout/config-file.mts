import assert from 'node:assert/strict'

export const DEFAULT_ROOT_VITEST_CONFIG = 'vitest.config.mts'

export function assertCanonicalRootVitestConfig(
  files: readonly string[],
  configFileName = DEFAULT_ROOT_VITEST_CONFIG,
): void {
  assert.deepEqual(files.filter((file) => file.startsWith('vitest.config.')).toSorted(), [
    configFileName,
  ])
}

export function checkCanonicalRootVitestConfigControls(
  configFileName = DEFAULT_ROOT_VITEST_CONFIG,
) {
  const alternate = configFileName.endsWith('.mts') ? 'vitest.config.ts' : 'vitest.config.mts'
  const cases = [
    { name: 'canonical', files: ['README.md', configFileName], admitted: true },
    { name: 'missing', files: ['README.md'], admitted: false },
    { name: 'alternate', files: [alternate], admitted: false },
    { name: 'additional', files: [configFileName, alternate], admitted: false },
  ]
  for (const control of cases) {
    if (control.admitted) assertCanonicalRootVitestConfig(control.files, configFileName)
    else
      assert.throws(
        () => assertCanonicalRootVitestConfig(control.files, configFileName),
        assert.AssertionError,
      )
  }
  return cases.map(({ name, admitted }) => ({ name, admitted }))
}
