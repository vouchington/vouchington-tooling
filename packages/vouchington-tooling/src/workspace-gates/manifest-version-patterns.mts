export const SEMVER_SOURCE = '[~^<>=*v\\s]*\\d+\\.\\d+(?:\\.\\d+)?(?:[-+][0-9A-Za-z.-]+)?'
export const SEMVER_LITERAL = new RegExp(`^${SEMVER_SOURCE}$`, 'u')

export type DependencyMatcher = {
  readonly name: string
  readonly member: RegExp
  readonly objectValue: RegExp
  readonly packageSpec: RegExp
}

function escapeRegex(value: string): string {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

export function buildDependencyMatchers(names: ReadonlySet<string>): DependencyMatcher[] {
  return [...names].map((name) => {
    const escaped = escapeRegex(name)
    const plainName = /^[A-Za-z_$][\w$]*$/u.test(name)
    const member = plainName
      ? `(?:\\[\\s*['"]${escaped}['"]\\s*\\]|\\.\\s*${escaped})`
      : `\\[\\s*['"]${escaped}['"]\\s*\\]`
    const key = plainName ? `(?:${escaped}|['"]${escaped}['"])` : `['"]${escaped}['"]`
    return {
      name,
      member: new RegExp(member, 'u'),
      objectValue: new RegExp(`${key}\\s*:\\s*(['"])${SEMVER_SOURCE}\\1`, 'u'),
      packageSpec: new RegExp(`^${escaped}@${SEMVER_SOURCE}$`, 'u'),
    }
  })
}
