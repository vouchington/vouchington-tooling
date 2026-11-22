---
'vouchington-tooling': minor
---

Add a `vouchington-tooling/public-source-literals` subpath whose `checkPublicSourceLiterals(ctx, options)`
flags deployment-specific literals (Sentry DSNs and organization slugs, AWS account ids, ECR registries,
S3 buckets, Lambda function URLs, GCP service accounts, maintainer home paths, AWS profile names) in the
tracked text files of a public repository. Repo-specific patterns, S3 placeholder buckets, and ignored
paths are the `extraPatterns`, `allowedS3Buckets`, and `ignorePaths` options.
