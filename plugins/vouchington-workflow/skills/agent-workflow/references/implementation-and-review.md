# Implementation and review

Before editing, map callers, tests, configuration, and documentation that own the behavior. Keep the
change within the accepted boundary; record a new dependency or product decision before widening it.

After focused validation, inspect the complete diff for accidental generated files, secret exposure,
dead paths, and documentation drift. Validate the public interface and failure paths, not only the
happy path. Before a reviewable commit, run the repository-required checks and state any skipped
checks with their concrete blocker.
