import ts from '../contract-schema/typescript-api.mts'
import { someSseArgumentValue } from './protocol-sse-literal-arguments.mts'
import {
  expressionReceiver,
  sameWriteReceiver,
  type WriteReceiver,
} from './protocol-write-receiver.mts'
import { visit } from './response-contract-route-analysis.mts'

/** A tag receives literal substitutions and any selected capability captured by a callable. */
function selectedSseTagArgument(
  node: ts.TaggedTemplateExpression,
  checker: ts.TypeChecker,
  selected: (expression: ts.Expression) => boolean,
): boolean {
  return (
    ts.isTemplateExpression(node.template) &&
    node.template.templateSpans.some(({ expression }) =>
      someSseArgumentValue(expression, checker, (leaf) => {
        if (selected(leaf)) return true
        if (!ts.isArrowFunction(leaf) && !ts.isFunctionExpression(leaf)) return false
        let captured = false
        visit(leaf, (child) => {
          if (ts.isExpression(child) && selected(child)) captured = true
        })
        return captured
      }),
    )
  )
}

/** Compare substitutions with the exact caller-bound frame receivers. */
export function selectedSseTagReceiver(
  node: ts.TaggedTemplateExpression,
  checker: ts.TypeChecker,
  frames: readonly WriteReceiver[],
  resolve: (receiver: WriteReceiver) => readonly (WriteReceiver | undefined)[],
): boolean {
  return selectedSseTagArgument(node, checker, (expression) => {
    const receiver = expressionReceiver(expression, checker)
    return (
      !!receiver &&
      resolve(receiver).some(
        (value) =>
          value === undefined ||
          frames.some((frame) =>
            resolve(frame).some(
              (selected) => selected === undefined || sameWriteReceiver(selected, value),
            ),
          ),
      )
    )
  })
}
