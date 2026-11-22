export const DEFAULT_EXCLUDED_PATH_RE = /(?:^|\/)(?:node_modules|vendor|dist|coverage)(?:\/|$)/
const PUBLIC_DOCUMENT_RE = /\.(?:md|txt)$/
const YAML_RE = /\.ya?ml$/i
const LITERAL_ASSIGNMENT_FILE_RE = /(?:^|\/)\.env(?:\.[^/]*)?$|\.(?:bash|md|sh|txt|zsh)$/i
export const GENERIC_S3_BUCKET_RE =
  /^(?:\*|\.\.\.|bucket|example(?:-bucket)?|test(?:-bucket)?|test-images|placeholder)$/i
export const INJECTED_S3_BUCKET_RE = /^(?:[<${]|\\+\(\$)/
const SYNTHETIC_HOME_USERS = 'dev|developer|user|runner|tester|someone|redacted|example'
const LINUX_HOME_APPLICATION_SEGMENTS = 'settings'
const LINUX_HOME_USERS = `${SYNTHETIC_HOME_USERS}|node|ubuntu|debian|www-data|nobody|linuxbrew|ec2-user|${LINUX_HOME_APPLICATION_SEGMENTS}`
export const AWS_EVENT_ACCOUNT_RE =
  /(?:["']account["']|\baccount\b)\s*:\s*["']?(?!(?:123456789012\b|<|\$|\{))\d{12}\b/gi
export const AWS_EVENT_DISCRIMINATOR_RE =
  /(?:(?<![A-Za-z0-9_-])detail-type(?![A-Za-z0-9_-])|\beventSourceARN\b|\bTopicArn\b|\baws:(?:sns|sqs|events)\b|\bsource\b["']?\s*:\s*["']?aws\.)/i

function maintainerHomeExpression(root: 'Users' | 'home', users: string): RegExp {
  return new RegExp(
    `(?<![A-Za-z0-9._-])/${root}/(?!(?:${users})(?:/|(?![A-Za-z0-9._-]))|<[^>]+>)[A-Za-z][A-Za-z0-9._-]*`,
  )
}

export type LiteralPattern = {
  category: string
  expression: RegExp
  appliesTo?: (file: string) => boolean
}

export const DEFAULT_PATTERNS: readonly LiteralPattern[] = [
  {
    category: 'sentry endpoint',
    expression: /https:\/\/[^\s/@]+@o\d+\.ingest(?:\.[a-z0-9-]+)?\.sentry\.io\/\d+/i,
  },
  {
    category: 'Sentry ingest host',
    expression: /(?<!@)\bo\d+\.ingest(?:\.[a-z0-9-]+)?\.sentry\.io\b/i,
  },
  {
    category: 'Sentry DSN assignment',
    expression:
      /\bSENTRY_(?:(?:WEB_)?DSN|TUNNEL_PREVIOUS_WEB_DSN)\b["']?\s*(?::|=)\s*["']?https:\/\/[A-Za-z0-9_]+@(?!(?:[A-Za-z0-9-]+\.)?example\.test(?::|\/|$))(?:\[[0-9a-f:]+\]|[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?)(?::\d+)?\/(?:[A-Za-z0-9._-]+\/)*\d+(?=$|[\s"'`,;)\]}])/i,
  },
  {
    category: 'Sentry configuration identifier',
    expression:
      /(?:\bSENTRY_(?:ORG|PROJECT(?:_ID)?)\b["']?\s*:\s*["'](?!(?:<|\$))[A-Za-z0-9][A-Za-z0-9_-]*["']|\bSENTRY_(?:ORG|PROJECT(?:_ID)?)\b\s*=\s*(?:["'](?!(?:<|\$|\{))[A-Za-z0-9][A-Za-z0-9_-]*["']|\d+(?=$|[\s#;,)\]}])|[A-Za-z0-9_]+-[A-Za-z0-9_-]*(?=$|[\s#;,)\]}])))/i,
  },
  {
    category: 'Sentry configuration identifier',
    expression:
      /^[ \t]*(?:export\s+)?SENTRY_(?:ORG|PROJECT(?:_ID)?)\s*=\s*(?!(?:<|\$|\{))[A-Za-z][A-Za-z0-9_]*\s*(?:#.*)?$/im,
    appliesTo: (file) => LITERAL_ASSIGNMENT_FILE_RE.test(file),
  },
  {
    category: 'Sentry configuration identifier',
    expression:
      /^[ \t]*SENTRY_(?:ORG|PROJECT(?:_ID)?)\s*:\s*(?!(?:["'<$]|\{))[A-Za-z0-9][A-Za-z0-9_-]*(?=\s*(?:#.*)?$)/im,
    appliesTo: (file) => YAML_RE.test(file),
  },
  {
    category: 'Sentry organization prose identifier',
    expression: /-\s*organization:\s*`(?!SENTRY_ORG\b|\$|<)[^`\n]+`/i,
    appliesTo: (file) => PUBLIC_DOCUMENT_RE.test(file),
  },
  {
    category: 'Sentry project or organization identifier',
    expression: /(?:\bSentry\b[^\n]{0,120}\b\d{10,}\b|\b\d{10,}\b[^\n]{0,120}\bSentry\b)/i,
  },
  {
    category: 'lambda function URL',
    expression: /\b[a-z0-9]{20,}\.lambda-url\.[a-z0-9-]+\.on\.aws\b/i,
  },
  {
    category: 'AWS account identifier',
    expression: /\barn:aws:[^:\s]+:[^:\s]*:(?!123456789012\b)\d{12}:/i,
  },
  {
    category: 'AWS account identifier',
    expression:
      /\bAWS[_-]?ACCOUNT[_-]?ID\b["']?\s*(?::|=)\s*["']?(?!(?:123456789012\b|<|\$|\{))\d{12}\b/i,
  },
  {
    category: 'AWS account identifier',
    expression: /\.amazonaws\.com(?:\.cn)?\/(?!123456789012\b)\d{12}\b/i,
  },
  {
    category: 'ECR registry',
    expression: /\b(?!123456789012\.)\d{12}\.dkr\.ecr\.[a-z0-9-]+\.amazonaws\.com\b/i,
  },
  {
    category: 'Google service-account identity',
    expression:
      /\b[A-Za-z0-9._%+-]+@(?!example\.iam\.gserviceaccount\.com\b)[A-Za-z0-9.-]+\.iam\.gserviceaccount\.com\b/i,
  },
  {
    category: 'Google service-account identity',
    expression:
      /\b(?!123456789012-compute@developer\.gserviceaccount\.com\b)\d{6,}-compute@developer\.gserviceaccount\.com\b/i,
  },
  {
    category: 'Google service-account identity',
    expression:
      /\b(?!123456789012@(?:cloudservices|cloudbuild)\.gserviceaccount\.com\b)\d{6,}@(cloudservices|cloudbuild)\.gserviceaccount\.com\b/i,
  },
  {
    category: 'Google service-account identity',
    expression:
      /\b(?!(?:example|test|placeholder)@appspot\.gserviceaccount\.com\b)[a-z][a-z0-9-]{4,29}@appspot\.gserviceaccount\.com\b/i,
  },
  {
    category: 'maintainer-local path',
    expression: maintainerHomeExpression('Users', SYNTHETIC_HOME_USERS),
  },
  {
    category: 'maintainer-local path',
    expression: maintainerHomeExpression('home', LINUX_HOME_USERS),
  },
  {
    category: 'local-host identity',
    expression:
      /\b(?!dev@myhost\.local\b|developer@myhost\.local\b|user@myhost\.local\b|runner@myhost\.local\b|tester@myhost\.local\b|someone@myhost\.local\b|redacted@myhost\.local\b|example@myhost\.local\b)[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.local\b/i,
  },
  {
    category: 'AWS CLI profile',
    expression: /--profile(?:\s+|=)(?!(?:["']?(?:<|\$)))["']?[A-Za-z0-9][A-Za-z0-9_-]*["']?/,
    appliesTo: (file) => PUBLIC_DOCUMENT_RE.test(file),
  },
  {
    category: 'AWS runbook argument',
    expression:
      /--(?:region|endpoint-url|queue-url|function-name|cluster|services?|task-definition|log-group-names?|alarm-names?|table-name|parameter-name|secret-id|bucket)(?:\s+|=)(?!(?:["']?(?:<|\$)))["']?[A-Za-z0-9][A-Za-z0-9_./:-]*["']?/,
    appliesTo: (file) => PUBLIC_DOCUMENT_RE.test(file),
  },
  {
    category: 'AWS CLI profile assignment',
    expression:
      /(?<![A-Za-z0-9_])(?:AWS_PROFILE|PROFILE|READ_PROFILE)=(?!(?:["']?(?:<|\$)))["']?[A-Za-z0-9][A-Za-z0-9_-]*["']?/,
    appliesTo: (file) => PUBLIC_DOCUMENT_RE.test(file),
  },
]
