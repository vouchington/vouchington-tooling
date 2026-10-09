/** Minimal structural facts; public declarations do not require the optional SQL parser peer. */
export type GeneratedArbiterName = { parts: readonly { identity: string }[] }

type GeneratedArbiterRoot =
  | { kind: 'columnReference'; name: GeneratedArbiterName }
  | { kind: 'parenthesized'; expression: GeneratedArbiterRoot }
  | {
      kind:
        | 'functionCall'
        | 'cast'
        | 'nullTest'
        | 'distinctness'
        | 'parameter'
        | 'typedLiteral'
        | 'literal'
        | 'binary'
        | 'unary'
        | 'case'
        | 'subquery'
        | 'other'
    }

export type GeneratedArbiterExpression = {
  columns: readonly GeneratedArbiterName[]
  root: GeneratedArbiterRoot
  childrenComplete?: boolean
}

export type GeneratedArbiterConflict = {
  target:
    | { kind: 'columns'; columns: readonly { identity: string }[] }
    | { kind: 'expressions'; expressions: readonly GeneratedArbiterExpression[] }
    | { kind: 'constraint' | 'omitted' }
  predicate: GeneratedArbiterExpression | null
  action:
    | { kind: 'doNothing' }
    | {
        kind: 'doUpdate'
        assignments: readonly {
          columns: readonly GeneratedArbiterName[]
          expression: GeneratedArbiterExpression
          complete: boolean
          target?: { subscripts: readonly unknown[]; indirection?: readonly unknown[] }
        }[]
      }
}
