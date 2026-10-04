import ts from '../contract-schema/typescript-api.mts'
import {
  hasRawBytes,
  indirectPayload,
  reflectApplyInvocation,
  writeAccess,
} from './protocol-sse-write-resolution.mts'

type WriteInvocation = {
  receiver: ts.Expression | undefined
  method: string | undefined
  rawBytes: boolean
}

/** Resolves direct and indirect SSE writes without losing their actual receiver. */
export function sseWriteInvocation(
  call: ts.CallExpression,
  checker: ts.TypeChecker,
): WriteInvocation | undefined {
  const reflected = reflectApplyInvocation(call, checker)
  if (reflected) return reflected
  const access = writeAccess(call.expression)
  if (!access) return undefined
  if (access.method === 'pipe')
    return call.arguments[0]
      ? { receiver: call.arguments[0], method: 'write', rawBytes: true }
      : undefined
  if (access.method === 'bind') {
    const target = writeAccess(access.receiver)
    if (target?.method !== 'write' && target?.method !== 'end') return undefined
    return { receiver: call.arguments[0], method: target.method, rawBytes: true }
  }
  if (access.method !== 'call' && access.method !== 'apply')
    return { ...access, rawBytes: hasRawBytes(access.method, call.arguments, checker, false) }

  const target = writeAccess(access.receiver)
  const receiver = call.arguments[0]
  if (!receiver) return undefined
  const payload = indirectPayload(access.method, call, checker)
  if (target?.method === 'pipe') {
    const destination = payload?.[0]
    return {
      receiver: destination,
      method: 'write',
      rawBytes: payload === undefined || destination !== undefined,
    }
  }
  const method = target?.method === 'write' || target?.method === 'end' ? target.method : undefined
  return {
    receiver,
    method,
    rawBytes: payload === undefined || hasRawBytes(method, payload, checker, true),
  }
}
