/** The sections a hand-written retrospective needs, every source fully assessed. */
export const ASSESSED_SECTIONS = [
  '## Verifiable Facts',
  '=== Retrospective Facts ===',
  'PR: 5',
  '',
  '## Transcript Facts',
  '=== Transcript Facts ===',
  'User prompts: 3',
  '',
  '## CI Failures',
  'Status: none observed',
  '',
  '## Sandbox & Permission Audit',
  'Status: none observed (journal entries only)',
  '',
  '## Tool Findings',
  'Status: none observed (read the tool results)',
  '',
  '## Architecture Findings',
  'Status: none observed (read the changed modules)',
].join('\n')

/** The same sections with every source marked as not assessed. */
export const UNASSESSED_SECTIONS = ASSESSED_SECTIONS.replace('PR: 5', 'Status: unavailable (n/a)')
  .replace('User prompts: 3', 'Status: not assessed (no transcript)')
  .replace('Status: none observed\n', 'Status: unavailable (not assessed)\n')
  .replace('Status: none observed (journal entries only)', 'Status: unavailable (not assessed)')
  .replace('Status: none observed (read the tool results)', 'Status: not assessed (skipped)')
  .replace('Status: none observed (read the changed modules)', 'Status: not assessed (skipped)')
