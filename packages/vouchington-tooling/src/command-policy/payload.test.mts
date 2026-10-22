import { describe, expect, it } from 'vitest'

import {
  extractToolCommand,
  hookCwd,
  hookFilePath,
  hookSessionId,
  hookToolInput,
  hookToolName,
} from './index.mts'

describe('hook payload accessors', () => {
  it('reads tool input in either casing', () => {
    expect(hookToolInput({ tool_input: { a: 1 } })).toEqual({ a: 1 })
    expect(hookToolInput({ toolInput: { b: 2 } })).toEqual({ b: 2 })
    expect(hookToolInput({ tool_input: 'x' })).toBeUndefined()
    expect(hookToolInput({})).toBeUndefined()
  })

  it('reads the command from tool input, then the payload', () => {
    expect(extractToolCommand({ tool_input: { command: 'ls' } })).toBe('ls')
    expect(extractToolCommand({ command: 'pwd' })).toBe('pwd')
    expect(extractToolCommand({ tool_input: { command: 1 } })).toBe('')
    expect(extractToolCommand({})).toBe('')
  })

  it('reads and trims tool names and session ids', () => {
    expect(hookToolName({ tool_name: ' Bash ' })).toBe('Bash')
    expect(hookToolName({ tool_name: ' ', toolName: 'Edit' })).toBe('Edit')
    expect(hookToolName({ tool_name: 3 })).toBe('')
    expect(hookSessionId({ session_id: 's1' })).toBe('s1')
    expect(hookSessionId({ sessionId: 's2' })).toBe('s2')
    expect(hookSessionId({ conversation_id: 'c' })).toBe('c')
    expect(hookSessionId({})).toBe('')
  })

  it('reads the file path from the payload or tool input', () => {
    expect(hookFilePath({ file_path: '/a' })).toBe('/a')
    expect(hookFilePath({ filePath: '/b' })).toBe('/b')
    expect(hookFilePath({ tool_input: { file_path: '/c' } })).toBe('/c')
    expect(hookFilePath({ tool_input: { filePath: '/d' } })).toBe('/d')
    expect(hookFilePath({ tool_input: { path: '/e' } })).toBe('/e')
    expect(hookFilePath({ file_path: '', tool_input: { path: '' } })).toBe('')
    expect(hookFilePath({})).toBe('')
  })

  it('resolves the working directory by precedence', () => {
    expect(hookCwd({ tool_input: { cwd: '/t' }, cwd: '/p' })).toBe('/t')
    expect(hookCwd({ tool_input: { workdir: '/w' } })).toBe('/w')
    expect(hookCwd({ cwd: '/p' })).toBe('/p')
    expect(hookCwd({ workspaceRoot: '/r' })).toBe('/r')
    expect(hookCwd({}, '/fallback')).toBe('/fallback')
    expect(hookCwd({ cwd: '', tool_input: { cwd: '' } }, '/fallback')).toBe('/fallback')
    expect(hookCwd({})).toBe(process.cwd())
  })
})
