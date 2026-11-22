import { GENERIC_S3_BUCKET_RE, INJECTED_S3_BUCKET_RE } from './patterns.mts'

const S3_LOCATIONS = [
  /s3:\/\/([^/\s`"'?#]+)/gi,
  /arn:aws(?:-[a-z0-9-]+)?:s3:::([^/\s`"'?#]+)/gi,
  /https?:\/\/([^/\s`"'?#]+?)\.s3[a-z0-9-]*(?:\.[a-z0-9-]+)*\.amazonaws\.com(?:\.cn)?(?=[:/\s`"']|$)/gi,
  /https?:\/\/s3[a-z0-9-]*(?:\.[a-z0-9-]+)*\.amazonaws\.com(?:\.cn)?\/([^/\s`"'?#]+)/gi,
]

/** Returns the string offset of every S3 bucket reference that is not injected or generic. */
export function findS3LocationOffsets(
  content: string,
  allowedBuckets: ReadonlySet<string>,
): Array<number | undefined> {
  const offsets: Array<number | undefined> = []
  for (const expression of S3_LOCATIONS) {
    for (const match of content.matchAll(expression)) {
      const bucket = match[1] as string
      if (
        INJECTED_S3_BUCKET_RE.test(bucket) ||
        GENERIC_S3_BUCKET_RE.test(bucket) ||
        allowedBuckets.has(bucket.toLowerCase())
      )
        continue
      offsets.push(match.index)
    }
  }
  return offsets
}
