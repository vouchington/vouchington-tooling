import { type NodeLike } from './ast-helpers.mts'

const CHILDREN: Readonly<Record<string, readonly string[]>> = {
  AwaitExpression: ['argument'],
  SpreadElement: ['argument'],
  UnaryExpression: ['argument'],
  UpdateExpression: ['argument'],
  YieldExpression: ['argument'],
  BinaryExpression: ['left', 'right'],
  AssignmentExpression: ['left', 'right'],
  LogicalExpression: ['left', 'right'],
  ConditionalExpression: ['test', 'consequent', 'alternate'],
  ArrayExpression: ['elements'],
  ArrayPattern: ['elements'],
  ObjectPattern: ['properties'],
  AssignmentPattern: ['left', 'right'],
  RestElement: ['argument'],
  SequenceExpression: ['expressions'],
  ObjectExpression: ['properties'],
  Property: ['key', 'value'],
  MemberExpression: ['object', 'property'],
  CallExpression: ['callee', 'arguments'],
  NewExpression: ['callee', 'arguments'],
  TemplateLiteral: ['expressions'],
  TaggedTemplateExpression: ['tag', 'quasi'],
  ImportExpression: ['source', 'options'],
  ClassDeclaration: ['superClass', 'body'],
  ClassExpression: ['superClass', 'body'],
  ClassBody: ['body'],
  MethodDefinition: ['key'],
  StaticBlock: ['body'],
  JSXElement: ['openingElement', 'children'],
  JSXOpeningElement: ['attributes'],
  JSXAttribute: ['value'],
  JSXSpreadAttribute: ['argument'],
  JSXExpressionContainer: ['expression'],
  JSXSpreadChild: ['expression'],
  JSXFragment: ['children'],
}

export function runtimeChildren(node: NodeLike): NodeLike[] {
  const fields =
    node.type === 'PropertyDefinition'
      ? node.static
        ? ['key', 'value']
        : ['key']
      : (CHILDREN[node.type] ?? [])
  return fields.flatMap((field) => {
    const value = node[field] as NodeLike | null | undefined | (NodeLike | null)[]
    const children = Array.isArray(value) ? value : [value]
    return children.filter((child): child is NodeLike => Boolean(child))
  })
}
