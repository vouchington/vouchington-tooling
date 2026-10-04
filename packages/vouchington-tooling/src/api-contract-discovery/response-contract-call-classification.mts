import ts from '../contract-schema/typescript-api.mts'

import { isInErrorBranch } from './response-contract-error-branch.mts'
import { isXmlResponseCall } from './response-contract-media.mts'
import { containsResponseMarker } from './response-contract-registration.mts'
import {
  isContextMethod,
  isContextResponseBufferCall,
  isContextResponseEmptyCall,
} from './response-contract-route-analysis.mts'

export type ImplicitResponseCallLabel =
  | 'ctx.json()'
  | 'ctx.pipeline()'
  | 'ctx.response.xml()'
  | 'ctx.response.buffer()'
  | 'ctx.response.empty()'

export function implicitResponseCallLabel(
  call: ts.CallExpression,
  excludeDynamicErrorObjects = false,
): ImplicitResponseCallLabel | undefined {
  if (isContextMethod(call.expression, 'json')) {
    if (!call.arguments[0] || isInErrorBranch(call, excludeDynamicErrorObjects)) return undefined
    return 'ctx.json()'
  }
  if (isStreamJsonPipeline(call))
    return isInErrorBranch(call, excludeDynamicErrorObjects) ? undefined : 'ctx.pipeline()'
  if (isXmlResponseCall(call)) return call.arguments[0] ? 'ctx.response.xml()' : undefined
  if (isContextResponseBufferCall(call.expression)) return 'ctx.response.buffer()'
  if (isContextResponseEmptyCall(call.expression)) return 'ctx.response.empty()'
  if (isContextMethod(call.expression, 'pipeline') && !containsResponseMarker(call))
    return 'ctx.pipeline()'
  return undefined
}

function isStreamJsonPipeline(call: ts.CallExpression): boolean {
  if (!isContextMethod(call.expression, 'pipeline')) return false
  const pipelineBody = call.arguments[0]
  return (
    !!pipelineBody &&
    ts.isCallExpression(pipelineBody) &&
    ts.isIdentifier(pipelineBody.expression) &&
    pipelineBody.expression.text === 'streamJsonObject' &&
    !!pipelineBody.arguments[0]
  )
}
