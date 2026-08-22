export type ContractSchema = {
  root: ContractSchemaNode
  definitions: Record<string, ContractSchemaNode>
}

export type ContractSchemaNode =
  | { type: 'unknown' }
  | { type: 'null' }
  | { type: 'boolean' }
  | { type: 'number' }
  | { type: 'string'; format?: 'uuid' }
  | { type: 'literal'; value: boolean | number | string }
  | {
      type: 'array'
      items: ContractSchemaNode
      minItems?: number
      maxItems?: number
      uniqueItems?: boolean
    }
  | { type: 'tuple'; items: ContractSchemaNode[]; optionalItems: number; rest?: ContractSchemaNode }
  | {
      type: 'object'
      properties: Record<string, ContractSchemaProperty>
      additionalProperties: false | ContractSchemaNode
    }
  | { type: 'union'; variants: ContractSchemaNode[] }
  | { type: 'intersection'; variants: ContractSchemaNode[] }
  | { type: 'ref'; name: string }

export type ContractSchemaProperty = {
  required: boolean
  schema: ContractSchemaNode
}
