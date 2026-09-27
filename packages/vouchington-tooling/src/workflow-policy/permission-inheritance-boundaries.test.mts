import { describe, expect, it } from 'vitest'

import {
  callerCalleePermissionMismatches,
  type CallerCalleePermissionPolicy,
  type Workflow,
  type WorkflowTopology,
} from './index.mts'

const callerPath = 'automation/orchestrate.yml'
const calleePath = 'automation/execute.yml'
const callerJobId = `${callerPath}#invoke`
const inheritanceAware = {
  comparison: 'inheritance-aware',
} satisfies CallerCalleePermissionPolicy

type PermissionJob = {
  if?: boolean
  permissions?: unknown
}

function topology(): WorkflowTopology {
  return {
    workflows: [
      { id: callerPath, path: callerPath, jobIds: [callerJobId] },
      { id: calleePath, path: calleePath, jobIds: [], callable: true },
    ],
    jobs: [{ id: callerJobId, workflowId: callerPath, key: 'invoke', steps: [] }],
    edges: [{ kind: 'calls', local: true, from: callerJobId, to: calleePath }],
  }
}

function documents(args: {
  callerPermissions?: unknown
  callerPermissionsPresent?: boolean
  calleePermissions?: unknown
  calleePermissionsPresent?: boolean
  calleeJobs?: Record<string, PermissionJob>
}): Record<string, Workflow> {
  const callerJob: PermissionJob = {}
  if (args.callerPermissionsPresent !== false) {
    callerJob.permissions = args.callerPermissions
  }

  const callee: Workflow = {
    on: { workflow_call: null },
    jobs: args.calleeJobs ?? { execute: {} },
  }
  if (args.calleePermissionsPresent === true) {
    callee.permissions = args.calleePermissions
  }

  return {
    [callerPath]: { jobs: { invoke: callerJob } },
    [calleePath]: callee,
  }
}

function compare(args: Parameters<typeof documents>[0]): string[] {
  return callerCalleePermissionMismatches(topology(), documents(args), inheritanceAware)
}

function diagnostic(detail: string): string {
  return `  ${callerPath} job "invoke" → ${calleePath}: ${detail}`
}

describe('inheritance-aware reusable workflow permission comparison', () => {
  it('preserves omitted and explicit exact comparison behavior', () => {
    const input = documents({
      callerPermissions: 'write-all',
      calleePermissions: 'write-all',
      calleePermissionsPresent: true,
    })

    expect(callerCalleePermissionMismatches(topology(), input)).toEqual([])
    expect(callerCalleePermissionMismatches(topology(), input, { comparison: 'exact' })).toEqual([])
  })

  it('requires the caller job to declare a valid explicit permission map', () => {
    expect(compare({ callerPermissionsPresent: false })).toEqual([
      diagnostic('caller permissions must be an explicit map'),
    ])
    expect(compare({ callerPermissions: undefined })).toEqual([
      diagnostic('caller permissions must be an explicit map'),
    ])
    expect(compare({ callerPermissions: null })).toEqual([
      diagnostic('caller permissions must be an explicit map'),
    ])
    expect(compare({ callerPermissions: 'read-all' })).toEqual([
      diagnostic('caller permissions must be an explicit map'),
    ])
    for (const invalid of [
      [{ contents: 'read' }],
      { contents: 'banana' },
      { constructor: 'read' },
      { toString: 'read' },
      { ['__proto__']: 'read' },
      new Date(0),
      new Map([['contents', 'read']]),
      new Set(['contents']),
    ]) {
      expect(compare({ callerPermissions: invalid })).toEqual([
        diagnostic('caller permissions must be an explicit map'),
      ])
    }

    const missingJob = documents({ callerPermissions: { contents: 'read' } })
    missingJob[callerPath]!.jobs = {}
    expect(callerCalleePermissionMismatches(topology(), missingJob, inheritanceAware)).toEqual([
      diagnostic('caller permissions must be an explicit map'),
    ])
  })

  it('rejects write-all on either side even when both declarations match', () => {
    expect(compare({ callerPermissions: 'write-all' })).toEqual([
      diagnostic('caller grants write-all'),
    ])
    expect(
      compare({
        callerPermissions: { contents: 'read' },
        calleePermissions: 'write-all',
        calleePermissionsPresent: true,
      }),
    ).toEqual([diagnostic('callee requires write-all')])
    expect(
      compare({
        callerPermissions: 'write-all',
        calleePermissions: 'write-all',
        calleePermissionsPresent: true,
      }),
    ).toEqual([diagnostic('caller grants write-all')])
    expect(
      compare({
        callerPermissions: { contents: 'read' },
        calleeJobs: { execute: { permissions: 'write-all' } },
      }),
    ).toEqual([diagnostic('callee requires write-all')])
  })

  it('rejects present invalid top-level declarations instead of treating them as absent', () => {
    for (const invalid of [undefined, null, 'read', { contents: 'banana' }]) {
      expect(
        compare({
          callerPermissions: { contents: 'read' },
          calleePermissions: invalid,
          calleePermissionsPresent: true,
        }),
      ).toEqual([diagnostic('callee top-level permissions are invalid')])
    }
  })

  it('rejects every invalid explicit callee job beside a real inheriting job', () => {
    expect(
      compare({
        callerPermissions: { contents: 'read', issues: 'read' },
        calleeJobs: {
          inherits: {},
          nullValue: { permissions: null },
          undefinedValue: { permissions: undefined },
          scalarValue: { permissions: 'read' },
          unknownScope: { permissions: { frobnicate: 'read' } },
          unknownLevel: { permissions: { contents: 'banana' } },
          invalidIdToken: { permissions: { 'id-token': 'read' } },
          invalidModels: { permissions: { models: 'write' } },
          invalidVulnerabilityAlerts: { permissions: { 'vulnerability-alerts': 'write' } },
          inheritedConstructor: { permissions: { constructor: 'read' } },
          inheritedToString: { permissions: { toString: 'read' } },
          inheritedProto: { permissions: { ['__proto__']: 'read' } },
        },
      }),
    ).toEqual([
      diagnostic('callee job "nullValue" permissions are invalid'),
      diagnostic('callee job "undefinedValue" permissions are invalid'),
      diagnostic('callee job "scalarValue" permissions are invalid'),
      diagnostic('callee job "unknownScope" permissions are invalid'),
      diagnostic('callee job "unknownLevel" permissions are invalid'),
      diagnostic('callee job "invalidIdToken" permissions are invalid'),
      diagnostic('callee job "invalidModels" permissions are invalid'),
      diagnostic('callee job "invalidVulnerabilityAlerts" permissions are invalid'),
      diagnostic('callee job "inheritedConstructor" permissions are invalid'),
      diagnostic('callee job "inheritedToString" permissions are invalid'),
      diagnostic('callee job "inheritedProto" permissions are invalid'),
    ])
  })

  it('allows a caller envelope only when a callee job truly inherits it', () => {
    expect(
      compare({
        callerPermissions: { contents: 'read', issues: 'write' },
        calleeJobs: {
          explicit: { permissions: { contents: 'read' } },
          inherits: {},
        },
      }),
    ).toEqual([])

    expect(
      compare({
        callerPermissions: { contents: 'read', issues: 'write' },
        calleePermissions: { contents: 'read' },
        calleePermissionsPresent: true,
        calleeJobs: { inheritsTopLevel: {} },
      }),
    ).toEqual([
      diagnostic(
        'caller grants {"contents":"read","issues":"write"}, callee requires {"contents":"read"}',
      ),
    ])

    expect(
      compare({
        callerPermissions: { contents: 'read', issues: 'write' },
        calleeJobs: { explicit: { permissions: { contents: 'read' } } },
      }),
    ).toEqual([
      diagnostic(
        'caller grants {"contents":"read","issues":"write"}, callee requires {"contents":"read"}',
      ),
    ])
  })

  it('enforces every explicit callee requirement including skipped jobs', () => {
    expect(
      compare({
        callerPermissions: { contents: 'read', issues: 'read' },
        calleeJobs: {
          inherits: {},
          skipped: { if: false, permissions: { contents: 'write' } },
        },
      }),
    ).toEqual([
      diagnostic(
        'caller grants {"contents":"read","issues":"read"}, callee requires {"contents":"write"}',
      ),
    ])

    expect(
      compare({
        callerPermissions: { contents: 'read' },
        calleeJobs: {
          inherits: {},
          skipped: { if: false, permissions: { contents: 'read', issues: 'read' } },
        },
      }),
    ).toEqual([
      diagnostic(
        'caller grants {"contents":"read"}, callee requires {"contents":"read","issues":"read"}',
      ),
    ])
  })

  it('retains the strongest explicit requirement across top-level and ordered job grants', () => {
    expect(
      compare({
        callerPermissions: { contents: 'write' },
        calleePermissions: { contents: 'write' },
        calleePermissionsPresent: true,
        calleeJobs: {
          equal: { permissions: { contents: 'write' } },
          weaker: { permissions: { contents: 'read' } },
        },
      }),
    ).toEqual([])

    for (const calleeJobs of [
      {
        stronger: { permissions: { contents: 'write' } },
        weaker: { permissions: { contents: 'read' } },
      },
      {
        weaker: { permissions: { contents: 'read' } },
        stronger: { permissions: { contents: 'write' } },
      },
    ]) {
      expect(
        compare({
          callerPermissions: { contents: 'write' },
          calleeJobs,
        }),
      ).toEqual([])
    }
  })

  it('normalizes none grants and accepts valid empty explicit declarations', () => {
    expect(
      compare({
        callerPermissions: { contents: 'none' },
        calleePermissions: {},
        calleePermissionsPresent: true,
        calleeJobs: { execute: { permissions: { contents: 'none' } } },
      }),
    ).toEqual([])

    const nullPrototypePermissions = Object.assign(Object.create(null), { contents: 'read' })
    expect(
      compare({
        callerPermissions: nullPrototypePermissions,
        calleePermissions: nullPrototypePermissions,
        calleePermissionsPresent: true,
        calleeJobs: { execute: { permissions: {} } },
      }),
    ).toEqual([])
  })

  it('supports current permission scopes and expands read-all in strict mode', () => {
    expect(
      compare({
        callerPermissions: {
          'artifact-metadata': 'write',
          'code-quality': 'read',
          models: 'read',
          'vulnerability-alerts': 'read',
        },
        calleePermissions: {
          'artifact-metadata': 'write',
          'code-quality': 'read',
          models: 'read',
          'vulnerability-alerts': 'read',
        },
        calleePermissionsPresent: true,
        calleeJobs: { execute: { permissions: {} } },
      }),
    ).toEqual([])

    const readAll = compare({
      callerPermissions: { contents: 'read' },
      calleePermissions: 'read-all',
      calleePermissionsPresent: true,
      calleeJobs: { execute: { permissions: {} } },
    })
    expect(readAll).toHaveLength(1)
    expect(readAll[0]).toContain('"artifact-metadata":"read"')
    expect(readAll[0]).toContain('"code-quality":"read"')
    expect(readAll[0]).toContain('"vulnerability-alerts":"read"')
  })

  it('fails closed when a callable callee has no jobs', () => {
    expect(
      compare({
        callerPermissions: {},
        calleeJobs: {},
      }),
    ).toEqual([diagnostic('callee must declare at least one job')])

    const missingJobs = documents({ callerPermissions: {} })
    delete missingJobs[calleePath]!.jobs
    expect(callerCalleePermissionMismatches(topology(), missingJobs, inheritanceAware)).toEqual([
      diagnostic('callee must declare at least one job'),
    ])
  })

  it('rejects malformed jobs containers and entries before checking inheritance', () => {
    for (const invalidJobs of ['execute', 42, null, [], new Map([['execute', {}]])]) {
      const input = documents({ callerPermissions: { contents: 'read' } })
      ;(input[calleePath] as { jobs?: unknown }).jobs = invalidJobs
      expect(callerCalleePermissionMismatches(topology(), input, inheritanceAware)).toEqual([
        diagnostic('callee jobs are invalid'),
      ])
    }

    for (const invalidJob of ['execute', 42, null, undefined, []]) {
      const input = documents({ callerPermissions: { contents: 'read' } })
      ;(input[calleePath] as { jobs?: unknown }).jobs = { execute: invalidJob }
      expect(callerCalleePermissionMismatches(topology(), input, inheritanceAware)).toEqual([
        diagnostic('callee job "execute" is invalid'),
      ])
    }
  })
})
