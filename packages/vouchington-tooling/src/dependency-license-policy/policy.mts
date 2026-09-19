import { collectSpdxAtoms, evaluateSpdxExpression, parseSpdxExpression } from './spdx.mts'
import type {
  DependencyLicenseEvaluation,
  DependencyLicensePolicy,
  DependencyLicenseViolation,
  PnpmLicenseReport,
} from './types.mts'

function isAllowlisted(
  atomId: string,
  packageName: string,
  policy: DependencyLicensePolicy,
): boolean {
  return (policy.allowlist ?? []).some(
    (entry) =>
      entry.licenseId === atomId &&
      (entry.scope.kind === 'all' || entry.scope.packageNames.includes(packageName)),
  )
}

function isDenied(atomId: string, policy: DependencyLicensePolicy): boolean {
  return (
    policy.deniedLicenseIds.includes(atomId) ||
    policy.deniedLicensePrefixes.some((prefix) => atomId.startsWith(prefix))
  )
}

export function evaluatePackageLicenseExpression(
  licenseExpression: string,
  packageName: string,
  policy: DependencyLicensePolicy,
): DependencyLicenseEvaluation {
  const normalized = policy.knownLicenseAliases?.[licenseExpression] ?? licenseExpression
  let node
  try {
    node = parseSpdxExpression(normalized)
  } catch {
    return { ok: false, deniedAtoms: [licenseExpression] }
  }

  const isAtomAllowed = (atomId: string): boolean =>
    isAllowlisted(atomId, packageName, policy) || !isDenied(atomId, policy)
  const ok = evaluateSpdxExpression(node, isAtomAllowed)
  const deniedAtoms = ok ? [] : collectSpdxAtoms(node).filter((atomId) => !isAtomAllowed(atomId))
  return { ok, deniedAtoms }
}

export function evaluatePnpmLicenseReport(
  report: PnpmLicenseReport,
  policy: DependencyLicensePolicy,
): DependencyLicenseViolation[] {
  const violations: DependencyLicenseViolation[] = []
  for (const [licenseExpression, entries] of Object.entries(report)) {
    for (const entry of entries) {
      const evaluation = evaluatePackageLicenseExpression(licenseExpression, entry.name, policy)
      if (evaluation.ok) continue
      violations.push({
        ...evaluation,
        licenseExpression,
        packageName: entry.name,
        ...(entry.versions === undefined ? {} : { versions: entry.versions }),
      })
    }
  }
  return violations
}
