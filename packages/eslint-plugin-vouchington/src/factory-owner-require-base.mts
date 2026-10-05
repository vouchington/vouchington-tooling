import { staticPropertyName, unwrap, type NodeLike } from './ast-helpers.mts'

export function isPossibleRequireBase(value: NodeLike | undefined): boolean {
  const current = unwrap(value)
  if (!current) return false
  if (current.type !== 'Literal' && current.type !== 'TemplateLiteral') return true
  if (current.type === 'TemplateLiteral' && (current.expressions as unknown[]).length > 0)
    return true
  const name = staticPropertyName(current)
  if (typeof name !== 'string') return false
  return (
    name.startsWith('/') ||
    name.startsWith('file:') ||
    /^[A-Za-z]:[\\/]/u.test(name) ||
    name.startsWith('\\\\')
  )
}
