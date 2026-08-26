# Inline Review Payload Requirements

Write `code-review-payload.json` once, after collecting all findings. Its shape is:

```json
{
  "event": "COMMENT",
  "body": "Short verdict",
  "comments": [
    {
      "path": "path/to/file.ts",
      "line": 42,
      "side": "RIGHT",
      "body": "Actionable finding"
    }
  ]
}
```

Every finding must be an inline comment. The top-level body is only a short verdict and must not
contain findings that are absent from `comments`. If there are no findings, do not write the file.

Each comment needs `path`, `line`, `side` (`RIGHT` for an added or context line, `LEFT` for a removed
line), and `body`. For a multi-line range, also include both `start_line` and `start_side`. Place the
comment on a line in a diff hunk. The trusted poster may remap a stale location to the nearest
commentable line, but it will fail rather than convert inline findings into a body-only review.

Use GitHub `suggestion` fences for concrete replacements. Deduplicate findings and emit at most 15
comments. Keep the top-level body concise. The event must be `COMMENT`; never emit `APPROVE` or
`REQUEST_CHANGES`.

The only allowed payload-writing mechanism is the agent's file-writing tool. Do not use shell,
Python, Node, `gh`, or `curl` to create or publish the payload.
