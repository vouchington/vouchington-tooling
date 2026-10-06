import type {
  findVariable,
  NodeLike,
  propertyName,
  RuleContextLike,
  unwrap,
} from './ast-helpers.mts'

declare const construction: {
  createTypescriptProgramConstructionRule(settings: {
    findVariable: typeof findVariable
    propertyName: typeof propertyName
    unwrap: typeof unwrap
    options: unknown
  }): {
    create(context: RuleContextLike): Record<string, (node: NodeLike) => void>
  }
}

export = construction
