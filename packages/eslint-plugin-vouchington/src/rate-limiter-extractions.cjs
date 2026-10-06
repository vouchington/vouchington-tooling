'use strict'

function propertyName(member) {
  if (member?.type !== 'MemberExpression') return null
  if (!member.computed && member.property.type === 'Identifier') return member.property.name
  return member.computed ? staticPropertyName(member.property) : null
}

function memberIsRead(node) {
  const parent = node.parent
  if (parent?.type === 'AssignmentExpression' && parent.left === node) {
    return parent.operator !== '='
  }
  return !(parent?.type === 'UnaryExpression' && parent.operator === 'delete')
}

function patternPropertyName(property) {
  if (!property.computed && property.key.type === 'Identifier') return property.key.name
  return staticPropertyName(property.key)
}

function staticPropertyName(node) {
  let value = node
  while (
    value &&
    (value.type === 'ChainExpression' ||
      value.type === 'TSAsExpression' ||
      value.type === 'TSSatisfiesExpression' ||
      value.type === 'TSTypeAssertion' ||
      value.type === 'TSNonNullExpression')
  ) {
    value = value.expression
  }
  if (value?.type === 'Literal') return value.value
  if (value?.type === 'TemplateLiteral' && value.expressions.length === 0) {
    return value.quasis[0]?.value.cooked ?? value.quasis[0]?.value.raw ?? null
  }
  return null
}

function receiverAtPath(receiver, path) {
  return path.reduce(
    (object, property) => ({
      computed: true,
      end: receiver.end,
      object,
      parent: receiver.parent,
      property: {
        end: receiver.end,
        parent: receiver.parent,
        range: receiver.range,
        start: receiver.start,
        type: 'Literal',
        value: property,
      },
      range: receiver.range,
      start: receiver.start,
      type: 'MemberExpression',
    }),
    receiver,
  )
}

module.exports = {
  memberIsRead,
  patternPropertyName,
  propertyName,
  receiverAtPath,
}
