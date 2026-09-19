import parseSpdx from 'spdx-expression-parse'

export type SpdxNode =
  | { type: 'AND'; children: SpdxNode[] }
  | { type: 'OR'; children: SpdxNode[] }
  | { type: 'ATOM'; id: string }

type ParsedSpdxNode = ReturnType<typeof parseSpdx>

function isCustomLicenseReference(licenseId: string): boolean {
  return licenseId.startsWith('LicenseRef-') || licenseId.startsWith('DocumentRef-')
}

function convertParsedNode(parsed: ParsedSpdxNode): SpdxNode {
  if ('license' in parsed) {
    if (isCustomLicenseReference(parsed.license)) {
      throw new Error(`Custom SPDX license references are not allowed: ${parsed.license}`)
    }
    const id = `${parsed.license}${parsed.plus ? '+' : ''}${
      parsed.exception ? ` WITH ${parsed.exception}` : ''
    }`
    return { type: 'ATOM', id }
  }

  const type = parsed.conjunction === 'and' ? 'AND' : 'OR'
  const children = [convertParsedNode(parsed.left), convertParsedNode(parsed.right)].flatMap(
    (child) => (child.type === type ? child.children : [child]),
  )
  return { type, children }
}

export function parseSpdxExpression(expression: string): SpdxNode {
  if (expression.trim().length === 0) {
    throw new Error('Invalid SPDX license expression: expression is empty')
  }
  try {
    return convertParsedNode(parseSpdx(expression))
  } catch (error) {
    throw new Error(`Invalid SPDX license expression: ${String(error)}`, { cause: error })
  }
}

export function evaluateSpdxExpression(
  node: SpdxNode,
  isAtomAllowed: (atomId: string) => boolean,
): boolean {
  if (node.type === 'ATOM') return isAtomAllowed(node.id)
  if (node.type === 'OR') {
    return node.children.some((child) => evaluateSpdxExpression(child, isAtomAllowed))
  }
  return node.children.every((child) => evaluateSpdxExpression(child, isAtomAllowed))
}

export function collectSpdxAtoms(node: SpdxNode): string[] {
  if (node.type === 'ATOM') return [node.id]
  return node.children.flatMap(collectSpdxAtoms)
}
