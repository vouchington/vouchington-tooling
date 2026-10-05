import { describe, expect, it } from 'vitest'

import { callerCalleePermissionMismatches } from './permission-mismatches.mts'
import { missingTopLevelPermissionPaths, parseWorkflow } from './permissions.mts'
import { unprovisionedSecretsWithoutReadinessStep } from './secret-readiness.mts'
import type { WorkflowTopology } from './types.mts'

const callerPath = 'automation/release.yml'
const calleePath = 'automation/publish.yml'
const callerId = `${callerPath}#publish`
const calleeId = `${calleePath}#upload`

const guard = {
  index: 0,
  env: { RELEASE_KEY: '${{ secrets.RELEASE_KEY }}' },
  run: 'if [ -z "$RELEASE_KEY" ]; then echo missing; exit 1; fi',
  secretReferences: ['RELEASE_KEY'],
}

function topology(): WorkflowTopology {
  return {
    workflows: [
      { id: callerPath, path: callerPath, jobIds: [callerId] },
      { id: calleePath, path: calleePath, jobIds: [calleeId], callable: true },
    ],
    jobs: [
      { id: callerId, workflowId: callerPath, key: 'publish', steps: [] },
      {
        id: calleeId,
        workflowId: calleePath,
        key: 'upload',
        steps: [
          guard,
          { index: 1, condition: "vars.CHANNEL == 'stable'", secretReferences: ['RELEASE_KEY'] },
        ],
      },
    ],
    edges: [{ kind: 'calls', local: true, from: callerId, to: calleePath }],
  }
}

describe('consumer supplied workflow policies', () => {
  it('requires an early guard in each secret consuming job and exempts optional contracts', () => {
    const input = topology()
    input.jobs[1]!.secretReferences = ['RELEASE_KEY']
    const inventory = { RELEASE_KEY: { provisioned: false } }
    expect(unprovisionedSecretsWithoutReadinessStep(input, inventory)).toEqual([])
    input.jobs[1]!.steps[0]!.condition = "vars.CHANNEL == 'stable' && vars.EXTRA == 'true'"
    expect(unprovisionedSecretsWithoutReadinessStep(input, inventory)).toHaveLength(1)
    input.workflows[1]!.workflowCall = { secrets: { RELEASE_KEY: { required: false } } }
    expect(unprovisionedSecretsWithoutReadinessStep(input, inventory)).toEqual([])
  })

  it('compares reusable workflow permissions from supplied documents', () => {
    const documents = {
      [callerPath]: parseWorkflow(
        'on: push\njobs:\n  publish:\n    uses: ./publish.yml\n    permissions:\n      contents: read\n',
      ),
      [calleePath]: parseWorkflow(
        'on:\n  workflow_call:\npermissions:\n  contents: write\njobs:\n  upload:\n    runs-on: ubuntu-latest\n',
      ),
    }
    expect(missingTopLevelPermissionPaths(documents)).toEqual([callerPath])
    expect(callerCalleePermissionMismatches(topology(), documents)).toEqual([
      `  ${callerPath} job "publish" → ${calleePath}: caller grants {"contents":"read"}, callee requires {"contents":"write"}`,
    ])
    documents[callerPath].jobs!.publish!.permissions = { contents: 'write' }
    expect(callerCalleePermissionMismatches(topology(), documents)).toEqual([])
  })
})
