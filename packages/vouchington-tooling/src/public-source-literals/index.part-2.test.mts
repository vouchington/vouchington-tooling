import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { describe, expect, it } from 'vitest'

import { buildContextFromTrackedFiles, type SharedContext } from '../shared-context/index.mts'
import { checkPublicSourceLiterals, type PublicSourceLiteralsOptions } from './index.mts'

const FUNCTION_URL = `https://${'a'.repeat(26)}.lambda-url.us-west-2.on.aws/`
const SELF_HOSTED_SENTRY_DSN = ['https://private_key@', 'errors.internal.example/123'].join('')
const IPV6_SELF_HOSTED_SENTRY_DSN = ['https://private_key@[', '2001:db8::1]/123'].join('')
const COMPUTE_DEFAULT_SERVICE_ACCOUNT = [
  [123_456, 789_013].join(''),
  '-compute@developer.gserviceaccount.com',
].join('')
const APP_ENGINE_DEFAULT_SERVICE_ACCOUNT = ['private-project', '@appspot.gserviceaccount.com'].join(
  '',
)
const PRIVATE_INFRA_BLOB_LINK = [
  'https://github.com/acme/acme-infra/',
  'blob/main/opentofu/runbook.md',
].join('')
const PRIVATE_INFRA_TREE_LINK = ['https://github.com/acme/acme-infra/', 'tree/main/opentofu'].join(
  '',
)

async function runGuard(
  file: string,
  content: string,
  options: PublicSourceLiteralsOptions = {},
): Promise<string[]> {
  const root = mkdtempSync(join(tmpdir(), 'public-source-literals-'))
  const destination = join(root, file)
  mkdirSync(join(destination, '..'), { recursive: true })
  writeFileSync(destination, content)
  try {
    const ctx = buildContextFromTrackedFiles(root, [file])
    return (await checkPublicSourceLiterals(ctx, options)).errors
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

function withoutReader(ctx: SharedContext): SharedContext {
  const { readTrackedFile: _unused, ...rest } = ctx
  return rest
}

describe('public source literals additional deployment forms', async () => {
  it('flags concrete self-hosted Sentry DSN assignments while allowing injected expressions', async () => {
    expect(
      await runGuard(
        'config.mts',
        [
          ['SENTRY_DSN = "', SELF_HOSTED_SENTRY_DSN, '"'].join(''),
          ['SENTRY_WEB_DSN:', SELF_HOSTED_SENTRY_DSN].join(' '),
          ['SENTRY_TUNNEL_PREVIOUS_WEB_DSN:', SELF_HOSTED_SENTRY_DSN].join(' '),
          ['SENTRY_DSN:', IPV6_SELF_HOSTED_SENTRY_DSN].join(' '),
        ].join('\n'),
      ),
    ).toHaveLength(4)
    expect(
      await runGuard(
        'config.mts',
        [
          'SENTRY_DSN=${SENTRY_DSN}',
          'SENTRY_WEB_DSN = process.env.SENTRY_WEB_DSN',
          'SENTRY_TUNNEL_PREVIOUS_WEB_DSN = process.env.SENTRY_TUNNEL_PREVIOUS_WEB_DSN',
          'SENTRY_DSN: "https://public@example.test/123"',
        ].join('\n'),
      ),
    ).toEqual([])
  })

  it('flags path-style S3 endpoints while allowing injected and generic buckets', async () => {
    expect(
      await runGuard(
        'docs/operations/runbook.md',
        [
          ['https://s3.us-west-2.amazonaws.com/', 'private-deployment-bucket/reports'].join(''),
          ['https://s3.dualstack.us-west-2.amazonaws.com/', 'private-logs/reports'].join(''),
        ].join('\n'),
      ),
    ).toHaveLength(2)
    expect(
      await runGuard(
        'docs/operations/runbook.md',
        [
          'https://s3.amazonaws.com/bucket/reports',
          'https://s3.us-west-2.amazonaws.com/${S3_BUCKET}/reports',
        ].join('\n'),
      ),
    ).toEqual([])
  })

  it('flags default Compute Engine and App Engine service accounts with exact synthetic exemptions', async () => {
    expect(
      await runGuard(
        'config.yml',
        [COMPUTE_DEFAULT_SERVICE_ACCOUNT, APP_ENGINE_DEFAULT_SERVICE_ACCOUNT].join('\n'),
      ),
    ).toHaveLength(2)
    expect(
      await runGuard(
        'config.yml',
        [
          '123456789012-compute@developer.gserviceaccount.com',
          'example@appspot.gserviceaccount.com',
        ].join('\n'),
      ),
    ).toEqual([])
  })

  it('allows bare 12-digit account fields without AWS event context', async () => {
    const privateAccount = [111_222, 333_444].join('')
    expect(
      await runGuard(
        'event.json',
        [
          ['"account": "', privateAccount, '"'].join(''),
          ['account:', privateAccount].join(' '),
        ].join('\n'),
      ),
    ).toEqual([])
    expect(
      await runGuard(
        'billing.ts',
        [
          ['account:', privateAccount].join(' '),
          'post-detail-type-badge-review',
          'eventSource: analytics',
        ].join('\n'),
      ),
    ).toEqual([])
  })

  it('flags 12-digit account fields only with AWS event discriminators', async () => {
    const privateAccount = [111_222, 333_444].join('')
    expect(
      await runGuard(
        'event.json',
        [
          "'detail-type': 'Scheduled Event'",
          "source: 'aws.partner/stripe.com'",
          ['account:', privateAccount].join(' '),
        ].join('\n'),
      ),
    ).toHaveLength(1)
    expect(
      await runGuard(
        'sns.json',
        [
          ['TopicArn:', 'arn:aws:sns:us-west-2:placeholder:topic'].join(' '),
          ['account:', privateAccount].join(' '),
        ].join('\n'),
      ),
    ).toHaveLength(1)
    expect(
      await runGuard(
        'lambda.json',
        ['eventSource: aws:sns', ['account:', privateAccount].join(' ')].join('\n'),
      ),
    ).toHaveLength(1)
    expect(
      await runGuard(
        'event.json',
        [['{"source": "aws.ec2", "account": "', privateAccount, '"}'].join('')].join('\n'),
      ),
    ).toHaveLength(1)
    expect(
      await runGuard(
        'event.json',
        [
          "'detail-type': 'Scheduled Event'",
          "source: 'aws.partner/stripe.com'",
          'account: 123456789012',
          'account: ${AWS_ACCOUNT_ID}',
          'account: <aws-account-id>',
        ].join('\n'),
      ),
    ).toEqual([])
  })

  it('allows Linux application routes and generic service homes while flagging maintainer paths', async () => {
    expect(
      await runGuard(
        'web/app/page.tsx',
        [
          ['href: "/', 'home/settings"'].join(''),
          ['path: "/', 'home/settings/profile"'].join(''),
          ['HOME=/', 'home/node'].join(''),
          ['cwd: "/', 'home/node/app"'].join(''),
          ['HOME=/', 'home/ubuntu'].join(''),
          ['statfs:/', 'home/debian'].join(''),
          ['file:/', 'home/www-data/.cache'].join(''),
          ['root=/', 'home/nobody'].join(''),
          ['brew=/', 'home/linuxbrew'].join(''),
          ['user=/', 'home/ec2-user'].join(''),
          'from "@/components/home/settings"',
        ].join('\n'),
      ),
    ).toEqual([])
    const errors = await runGuard(
      'docs/development/example.md',
      [
        ['/', 'home/operator'].join(''),
        ['/', 'home/operator/project'].join(''),
        ['/', 'home/maintainer/actions-runner'].join(''),
        ['/', 'home/node-operator/src'].join(''),
        ['/', 'Users/operator'].join(''),
        ['/', 'Users/node/project'].join(''),
      ].join('\n'),
    )
    expect(errors.filter((error) => error.includes('maintainer-local path'))).toHaveLength(6)
  })

  it('applies extra patterns, honoring appliesTo, alongside the defaults', async () => {
    const extraPatterns = [
      {
        category: 'private infrastructure repository link',
        expression: /\bacme-infra\/(?:blob|tree)\//i,
      },
      {
        category: 'markdown only',
        expression: /internal-only-term/,
        appliesTo: (file: string) => file.endsWith('.md'),
      },
    ]
    const errors = await runGuard(
      'docs/operations/runbook.md',
      [PRIVATE_INFRA_BLOB_LINK, PRIVATE_INFRA_TREE_LINK, 'internal-only-term'].join('\n'),
      { extraPatterns },
    )
    expect(errors).toHaveLength(3)
    expect(errors.join('\n')).toContain('private infrastructure repository link')
    expect(await runGuard('notes.mts', 'internal-only-term', { extraPatterns })).toEqual([])
    expect(await runGuard('docs/runbook.md', PRIVATE_INFRA_BLOB_LINK)).toEqual([])
  })

  it('allows references to the private repository without a deep link', async () => {
    const extraPatterns = [{ category: 'link', expression: /\bacme-infra\/(?:blob|tree)\//i }]
    expect(
      await runGuard(
        'docs/operations/runbook.md',
        ['https://github.com/acme/acme-infra', 'https://github.com/acme/acme-infra/issues/47'].join(
          '\n',
        ),
        { extraPatterns },
      ),
    ).toEqual([])
  })

  it('allows configured S3 buckets and skips configured ignore paths', async () => {
    const location = ['s3:/', '/Partner-Uploads/file'].join('')
    expect(await runGuard('docs/runbook.md', location)).toHaveLength(1)
    expect(
      await runGuard('docs/runbook.md', location, { allowedS3Buckets: ['partner-uploads'] }),
    ).toEqual([])
    expect(await runGuard('fixtures/leak.md', FUNCTION_URL)).toHaveLength(1)
    expect(
      await runGuard('fixtures/leak.md', FUNCTION_URL, { ignorePaths: [/^fixtures\//] }),
    ).toEqual([])
  })

  it('does nothing outside a git repository and skips unreadable tracked files', async () => {
    const outside = {
      ...buildContextFromTrackedFiles('/nonexistent', ['a.md']),
      isInsideGitRepo: false,
    }
    expect(await checkPublicSourceLiterals(outside)).toEqual({ errors: [] })
    const missing = buildContextFromTrackedFiles('/nonexistent', ['a.md'])
    expect(await checkPublicSourceLiterals(missing)).toEqual({ errors: [] })
    const noReader = withoutReader(missing)
    expect(await checkPublicSourceLiterals(noReader)).toEqual({ errors: [] })
  })

  it('reads files from disk when the context has no cached reader', async () => {
    const root = mkdtempSync(join(tmpdir(), 'public-source-literals-'))
    try {
      writeFileSync(join(root, 'a.md'), FUNCTION_URL)
      const ctx = withoutReader(buildContextFromTrackedFiles(root, ['a.md']))
      expect((await checkPublicSourceLiterals(ctx)).errors).toHaveLength(1)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
