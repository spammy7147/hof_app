# Test Suite Simplification Design

## Goal

Reduce test maintenance code as aggressively as practical while preserving the regression protection that has caught production-relevant failures. Test-code reduction is the primary objective; shorter local feedback time is the secondary objective. Production behavior is out of scope.

## Current Baseline

The app has 49 test files, 425 test cases, and 10,977 test lines. Its full suite passes in approximately 11 seconds. Fifteen files containing 62 cases and 682 lines inspect implementation source with `readFileSync` and regular expressions.

The backend has 100 test classes, at least 514 directly annotated test methods, and 18,337 test lines. Automation accounts for 6,467 lines and 212 directly annotated cases. Thirty-five classes start Spring test slices or contexts, including 27 `@DataJpaTest` classes. A full local run reached 1 minute 49 seconds and ended with a Gradle test-worker `EOFException`, so the slow suite also needs a separate execution path.

## Reduction Strategy

Use a balanced reduction strategy weighted toward code volume:

1. Remove tests that inspect TypeScript source text or JSX spelling instead of observable behavior.
2. Collapse equivalent input variants into table-driven TypeScript tests or JUnit parameterized tests.
3. Keep detailed validation, sorting, normalization, and identity rules at the pure domain layer only.
4. Keep only representative rendering, interaction, failure recovery, accessibility, and stale-callback cases at the component layer.
5. Remove duplicated success-path assertions when the same contract is already covered by a controller, service, repository, or integration test at a more suitable boundary.
6. Extract small shared test fixtures only when the extraction removes substantial repeated setup without hiding the behavior under test.
7. Separate fast local tests from Spring-backed integration tests so TDD does not require the full context suite on every edit.

## Preservation Rules

The following protection must remain even when it costs more code:

- authentication, authorization, token, credential encryption, cookie, and security-boundary contracts;
- transaction, persistence mapping, concurrency, leasing, outbox, recovery, and atomicity behavior;
- parsers backed by captured or production-shaped HTML fixtures;
- API serialization and request/response discriminants that cross the app/backend boundary;
- the most recent regression tests for stale callbacks, identity changes, async response ownership, and captcha retries;
- one representative accessibility contract for every interactive pattern;
- one success and one failure/recovery path for each user-visible workflow.

Tests may be deleted only when their guarantee is implementation-shaped, obsolete, or demonstrably covered by a retained test at the correct boundary. A test must not be deleted merely because it is slow or difficult.

## App Design

### Source-inspection tests

Delete source-regex assertions for component composition, copy, hook names, callback spelling, and JSX structure. Retain configuration contracts only when they can read structured configuration, import the real module safely, or exercise observable behavior. Do not replace deleted source assertions one-for-one.

### Domain tests

Retain the domain suite as the primary home for validation matrices, ordering, normalization, map identity, preset discriminants, and request construction. Convert repeated examples with the same expected outcome into case tables. Each table should keep explicit case labels so failures remain diagnostic.

### Component tests

For the quest, battle-map, and adventure-map editors, retain a compact behavioral spine:

- initial/loading/error/empty rendering where materially different;
- one complete valid edit-and-save flow;
- invalid and busy mutation blocking;
- failed save/delete recovery;
- one dirty-back/delete contract;
- representative focus restoration and accessibility behavior;
- representative stale callback fencing for identity replacement, disabled/busy transition, and unmount;
- feature-specific behavior that has no domain-level equivalent.

Combine variants that exercise the same guard through a shared case table or helper. Remove UI assertions that repeat domain validation or catalog ordering already verified by pure functions.

## Backend Design

### Pure and mock-based tests

Parameterize repeated invalid-value, mismatch-field, state-transition, and parser examples. Preserve fixture-based parser cases. Consolidate setup builders within a package when multiple service tests construct the same account, automation action, battle evidence, or captcha state.

### Spring-backed tests

Retain Spring for query semantics, persistence mapping, transaction boundaries, security filters, schema migration, and concurrency behavior. Convert service tests that only need mocked collaborators to plain JUnit tests. Where controller and service tests assert the same successful payload, keep controller tests focused on HTTP/security/serialization and service tests focused on business decisions.

### Execution split

Provide a fast default test task for pure and lightweight tests and a separate integration task for Spring-backed tests. CI runs both. Local TDD runs the focused test first, then the fast suite; the integration suite runs before completion when backend behavior is affected.

## Safety and Verification

Work in small deletion/consolidation batches. After every batch, run the affected tests and inspect the diff to ensure no production files changed. At the end:

- run the full app test suite and TypeScript typecheck;
- run backend compilation and the fast suite;
- run the full backend integration suite and report infrastructure failures separately from assertion failures;
- recount files, cases, lines, and wall-clock duration against the baseline;
- review retained tests against every preservation rule.

## Success Criteria

- Reduce combined test lines by at least 25%, targeting 30-35% without weakening the preservation rules.
- Remove nearly all implementation-source regex assertions.
- Reduce or hold app suite time below the current approximately 11-second baseline.
- Make the backend fast suite complete reliably without starting unnecessary Spring contexts.
- Keep production source behavior unchanged.
- Leave both repositories free of unrelated modifications.

## Non-Goals

- Chasing a coverage percentage or test-count target at the expense of meaningful protection.
- Rewriting production architecture solely to make tests shorter.
- Removing recent regression tests simply because they are narrowly focused.
- Introducing snapshots that hide large, hard-to-review output changes.
