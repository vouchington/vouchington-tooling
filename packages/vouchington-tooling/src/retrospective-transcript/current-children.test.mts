import { expect, it } from 'vitest'
import { codexChildren } from './index.mts'
it('normalizes current hosted child activity and retains exact direct owner filtering', () => {
  const record = (thread: string, path: string) =>
    JSON.stringify({
      type: 'event_msg',
      payload: {
        type: 'item_completed',
        item: { type: 'SubAgentActivity', agent_thread_id: thread, agent_path: path },
      },
    })
  expect(
    codexChildren(
      [
        record('direct', '/root/task/child'),
        record('sibling', '/root/other/child'),
        record('nested', '/root/task/child/grandchild'),
        record('owner', '/root/task'),
      ],
      '/root/task',
    ),
  ).toEqual([{ threadId: 'direct', agentPath: '/root/task/child' }])
})
