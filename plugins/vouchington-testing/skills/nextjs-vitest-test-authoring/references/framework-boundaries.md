# Framework boundaries

Mock framework navigation, headers, cookies, and server-only APIs at the framework edge, not inside
the component or route under test. Preserve typed module shape and use the consumer's shared mocks
when they exist. Build API responses with typed factories rather than inline partial objects.

Use direct rendering for component behavior. If request scope, hydration, browser APIs, or server
module resolution cannot be represented faithfully, move the assertion to an integration or browser
test instead of widening a unit-test mock.
