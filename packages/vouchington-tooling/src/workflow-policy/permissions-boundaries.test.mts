import { describe, expect, it } from 'vitest'

import { callerCalleePermissionMismatches } from './permission-mismatches.mts'
import {
  missingTopLevelPermissionPaths,
  parsePermissions,
  permissionsToMap,
  parseWorkflow,
  requiredWorkflowPermissions,
} from './permissions.mts'
import type { WorkflowTopology } from './types.mts'

const caller = 'workflows/orchestrate.yml'
const callee = 'workflows/execute.yml'
const jobId = `${caller}#invoke`

function topology(local = true, callable = true): WorkflowTopology {
  return {
    workflows: [
      { id: 'caller-workflow-id', path: caller, jobIds: [jobId] },
      { id: callee, path: callee, jobIds: [], callable },
    ],
    jobs: [{ id: jobId, workflowId: 'caller-workflow-id', key: 'invoke', steps: [] }],
    edges: [{ kind: 'calls', local, from: jobId, to: callee }],
  }
}

function documents(callerPermissions?: unknown, calleePermissions?: unknown) {
  return {
    [caller]: { jobs: { invoke: { permissions: callerPermissions } } },
    [callee]: { on: { workflow_call: null }, permissions: calleePermissions },
  }
}

describe('reusable workflow permission comparison', () => {
  it('classifies missing, scalar and map permission inputs', () => {
    expect(parsePermissions(undefined)).toBeNull()
    expect(parsePermissions(['contents'])).toBeNull()
    expect(parsePermissions('read-all')).toBe('read-all')
    expect(parsePermissions('write-all')).toBe('write-all')
    expect(parsePermissions({ contents: 'read' })).toEqual(new Map([['contents', 'read']]))
    expect(permissionsToMap('read-all')?.get('contents')).toBe('read')
    expect(permissionsToMap(null)).toBeNull()
  })

  it('combines top level and job grants by strongest scope', () => {
    const workflow = parseWorkflow(
      'permissions:\n  contents: read\njobs:\n  first:\n    permissions:\n      contents: write\n      issues: read\n  second:\n    permissions:\n      issues: write\n',
    )
    expect(requiredWorkflowPermissions(workflow)).toEqual(
      new Map([
        ['contents', 'write'],
        ['issues', 'write'],
      ]),
    )
    expect(requiredWorkflowPermissions({ permissions: 'write-all' })).toBe('write-all')
    expect(requiredWorkflowPermissions({ jobs: { a: { permissions: 'write-all' } } })).toBe(
      'write-all',
    )
    expect(
      requiredWorkflowPermissions({
        permissions: 'read-all',
        jobs: { a: { permissions: 'read-all' } },
      }),
    ).toBe('read-all')
    expect(
      requiredWorkflowPermissions({ jobs: { a: { permissions: { contents: 'read' } } } }),
    ).toEqual(new Map([['contents', 'read']]))
    expect(
      requiredWorkflowPermissions({ permissions: { contents: 'read' }, jobs: { a: {} } }),
    ).toEqual(new Map([['contents', 'read']]))
  })

  it('requires top-level permissions except in pure workflow_call documents', () => {
    expect(
      missingTopLevelPermissionPaths({
        [caller]: { on: 'push' },
        [callee]: { on: { workflow_call: null } },
        'workflows/mixed.yml': { on: { workflow_call: null, push: null } },
      }),
    ).toEqual([caller, 'workflows/mixed.yml'])
  })

  it('fails closed on omitted documents and reports missing job-level grants', () => {
    expect(() => callerCalleePermissionMismatches(topology(), {})).toThrow(
      `missing workflow document: ${caller}`,
    )
    expect(() =>
      callerCalleePermissionMismatches(topology(), { [caller]: documents()[caller] }),
    ).toThrow(`missing workflow document: ${callee}`)
    expect(callerCalleePermissionMismatches(topology(), documents())).toEqual([
      `  ${caller} job "invoke" → ${callee}: missing explicit job-level permissions`,
    ])
    expect(
      callerCalleePermissionMismatches(topology(), { [caller]: { jobs: {} }, [callee]: {} }),
    ).toEqual([])
  })

  it('compares write-all, read-all and explicit maps exactly', () => {
    const writeAll = documents('write-all', { contents: 'read' })
    expect(callerCalleePermissionMismatches(topology(), writeAll)).toEqual([
      `  ${caller} job "invoke" → ${callee}: caller grants write-all, callee requires {"contents":"read"}`,
    ])
    expect(
      callerCalleePermissionMismatches(topology(), documents('write-all', 'write-all')),
    ).toEqual([])
    expect(
      callerCalleePermissionMismatches(topology(), documents({ contents: 'read' }, 'write-all')),
    ).toEqual([
      `  ${caller} job "invoke" → ${callee}: caller grants {"contents":"read"}, callee requires write-all`,
    ])
    const readAll = callerCalleePermissionMismatches(
      topology(),
      documents({ contents: 'read' }, 'read-all'),
    )
    expect(readAll[0]).toContain('callee requires {"actions":"read"')
    expect(
      callerCalleePermissionMismatches(
        topology(),
        documents({ contents: 'read' }, { contents: 'read' }),
      ),
    ).toEqual([])
    expect(
      callerCalleePermissionMismatches(
        topology(),
        documents({ issues: 'read', contents: 'read' }, { issues: 'write', contents: 'read' }),
      ),
    ).toEqual([
      `  ${caller} job "invoke" → ${callee}: caller grants {"contents":"read","issues":"read"}, callee requires {"contents":"read","issues":"write"}`,
    ])
    expect(callerCalleePermissionMismatches(topology(), documents('write-all'))).toEqual([
      `  ${caller} job "invoke" → ${callee}: caller grants write-all, callee requires none`,
    ])
    expect(
      callerCalleePermissionMismatches(
        topology(),
        documents('write-all', { issues: 'read', contents: 'read' }),
      ),
    ).toEqual([
      `  ${caller} job "invoke" → ${callee}: caller grants write-all, callee requires {"contents":"read","issues":"read"}`,
    ])
  })

  it('ignores remote and non-callable edges', () => {
    expect(callerCalleePermissionMismatches(topology(false), {})).toEqual([])
    expect(callerCalleePermissionMismatches(topology(true, false), {})).toEqual([])
  })
})
