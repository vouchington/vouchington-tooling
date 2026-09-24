/** A pnpm 12 env document that locks pnpm itself, including platform-specific binaries. */
export const PNPM_ENV_DOCUMENT = [
  '---',
  "lockfileVersion: '9.0'",
  '',
  'importers:',
  '',
  '  .:',
  '    configDependencies: {}',
  '    packageManagerDependencies:',
  '      pnpm:',
  '        specifier: 12.6.0',
  '        version: 12.6.0',
  '',
  'packages:',
  '',
  "  '@pnpm/exe.android-arm64@12.6.0':",
  '    resolution: {integrity: sha512-fixture}',
  '    cpu: [arm64]',
  '    os: [android]',
  '',
  "  '@pnpm/exe.linux-ppc64@12.6.0':",
  '    resolution: {integrity: sha512-fixture}',
  '    cpu: [ppc64]',
  '    os: [linux]',
  '    libc: [glibc]',
  '',
  '  pnpm@12.6.0:',
  '    resolution: {integrity: sha512-fixture}',
  '    hasBin: true',
  '',
].join('\n')

/** Prepends the pnpm 12 env document to a workspace graph document. */
export function twoDocumentLockfile(graph: string): string {
  return `${PNPM_ENV_DOCUMENT}---\n${graph}`
}
