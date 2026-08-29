# Component coverage

Keep a direct story for each supported reusable component state. When a component needs server-only
modules, request context, or browser-hostile imports, isolate the presentational surface or alias the
boundary to a deterministic fixture. Test interactive story behavior in browser mode when it owns
the component contract.

Allow story discovery to follow the consumer's module graph and glob configuration. Do not hand
maintain duplicate registration lists or make module-top-level browser assumptions.
