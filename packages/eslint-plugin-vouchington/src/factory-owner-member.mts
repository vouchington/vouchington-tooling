import { propertyName, type NodeLike } from './ast-helpers.mts'

export function isFactoryMember(
  value: NodeLike,
  factories: ReadonlySet<string>,
  isNamespace: (value: NodeLike) => boolean,
): boolean {
  const name = propertyName(value)
  return name !== null && factories.has(String(name)) && isNamespace(value.object as NodeLike)
}
