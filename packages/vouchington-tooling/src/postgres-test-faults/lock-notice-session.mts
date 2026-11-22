import type pg from 'pg'

export type Settings = {
  log_lock_waits: string
  deadlock_timeout: string
  client_min_messages: string
  statement_timeout: string
  application_name: string
}

export type LockNoticeOptions = {
  /** Return false to ignore notices outside the owned action. Defaults to always eligible. */
  eligible?: () => boolean
  /** Prefix of the unique `application_name` set on the observed session. Defaults to `lock-notice`. */
  applicationNamePrefix?: string
  /** Accepted `server_version_num` range, `min` inclusive and `max` exclusive. Defaults to PostgreSQL 18. */
  serverVersionNum?: { min: number; max: number }
  /** Appended to the prerequisite error, for example how to start a disposable database. */
  setupHint?: string
}

type SessionRow = Settings & {
  process_id: number
  version: number
  role_name: string
  database_name: string
  locale: string
  timeout_ms: number
  can_log: boolean
  can_set_deadlock: boolean
}

const SETTING_KEYS = [
  'log_lock_waits',
  'deadlock_timeout',
  'client_min_messages',
  'statement_timeout',
  'application_name',
] as const

export async function configureNoticeSession(
  client: Pick<pg.PoolClient, 'query'>,
  applicationName: string,
  options: LockNoticeOptions,
  remember: (settings: Settings) => void,
): Promise<{ processId: number; applicationName: string }> {
  const { rows } = await client.query<SessionRow>(`/* observePostgresLockNotice.settings */
      SELECT pg_backend_pid()::integer AS process_id,
        current_setting('server_version_num')::integer AS version,
        current_user AS role_name,
        current_database() AS database_name,
        current_setting('lc_messages') AS locale,
        current_setting('log_lock_waits') AS log_lock_waits,
        current_setting('deadlock_timeout') AS deadlock_timeout,
        current_setting('client_min_messages') AS client_min_messages,
        current_setting('statement_timeout') AS statement_timeout,
        current_setting('application_name') AS application_name,
        (SELECT setting::integer FROM pg_settings WHERE name = 'statement_timeout') AS timeout_ms,
        has_parameter_privilege(current_user, 'log_lock_waits', 'SET') AS can_log,
        has_parameter_privilege(current_user, 'deadlock_timeout', 'SET') AS can_set_deadlock
    `)
  const row = rows[0]
  if (!row) throw new Error('Owned contender did not report its session settings')
  const range = options.serverVersionNum ?? { min: 180000, max: 190000 }
  if (row.version < range.min || row.version >= range.max || !row.can_log || !row.can_set_deadlock)
    throw new Error(
      `Owned lock-wait observation requires a supported PostgreSQL version and session SET ` +
        `privileges: server_version_num=${row.version}, current_user=${row.role_name}, ` +
        `current_database()=${row.database_name}, can_log=${row.can_log}, ` +
        `can_set_deadlock=${row.can_set_deadlock}.${options.setupHint ? ` ${options.setupHint}` : ''}`,
    )
  if (!/^(C|POSIX|en_)/.test(row.locale))
    throw new Error('Owned lock-wait observation requires the normal English PostgreSQL notices')
  if (row.timeout_ms > 0 && row.timeout_ms < 1000)
    throw new Error(
      `Owned contender has insufficient statement-timeout headroom: ${row.timeout_ms}`,
    )
  remember(row)
  await client.query(
    `/* observePostgresLockNotice.configure */
      SELECT set_config('log_lock_waits', 'on', false),
        set_config('deadlock_timeout', '100ms', false),
        set_config('client_min_messages', 'log', false),
        set_config('statement_timeout', $1, false),
        set_config('application_name', $2, false)
    `,
    [String(row.timeout_ms === 0 ? 5000 : Math.min(row.timeout_ms, 5000)), applicationName],
  )
  return { processId: row.process_id, applicationName }
}

export async function restoreNoticeSession(
  client: Pick<pg.PoolClient, 'query'>,
  original: Settings,
): Promise<void> {
  const { rows } = await client.query<Settings>(
    `/* observePostgresLockNotice.restore */
      SELECT set_config('log_lock_waits', $1, false) AS log_lock_waits,
        set_config('deadlock_timeout', $2, false) AS deadlock_timeout,
        set_config('client_min_messages', $3, false) AS client_min_messages,
        set_config('statement_timeout', $4, false) AS statement_timeout,
        set_config('application_name', $5, false) AS application_name
    `,
    SETTING_KEYS.map((key) => original[key]),
  )
  for (const key of SETTING_KEYS)
    if (rows[0]?.[key] !== original[key])
      throw new Error(`Owned contender setting was not restored: ${key}`)
}
