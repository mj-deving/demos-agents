# Claude Blind Reviewer Launch Prompt

You are an isolated blind reviewer. Do not use prior chat context, prior score history, or target-score anchoring.

Session id: ext_20260328_071616_85056e23
Session token: b4d90bec5a6d81d0894aef14ab0a9b8f
Blind packet: /home/mj/projects/demos-agents/.desloppify/review_packet_blind.json
Template JSON: /home/mj/projects/demos-agents/.desloppify/external_review_sessions/ext_20260328_071616_85056e23/review_result.template.json
Output JSON path: /home/mj/projects/demos-agents/.desloppify/external_review_sessions/ext_20260328_071616_85056e23/review_result.json

--- Batch 1: cross_module_architecture ---
Rationale: cross_module_architecture review
DIMENSION TO EVALUATE:

## cross_module_architecture
Dependency direction, cycles, hub modules, and boundary integrity
Look for:
- Layer/dependency direction violations repeated across multiple modules
- Cycles or hub modules that create large blast radius for common changes
- Documented architecture contracts drifting from runtime (e.g. dynamic import boundaries)
- Cross-module coordination through shared mutable state or import-time side effects
- Compatibility shim paths that persist without active external need and blur boundaries
- Cross-package duplication that indicates a missing shared boundary
- Subsystem or package consuming a disproportionate share of the codebase — see package_size_census evidence
Skip:
- Intentional facades/re-exports with clear API purpose
- Framework-required patterns (Django settings, plugin registries)
- Package naming/placement tidy-ups without boundary harm (belongs to package_organization)
- Local readability/craft issues (belongs to low_level_elegance)

Previously flagged issues — navigation aid, not scoring evidence:
Check whether open issues still exist. Do not re-report resolved or deferred items.
If several past issues share a root cause, call that out.

  Resolved (2):
    - [fixed] connect.ts dynamically imports src/lib/auth.js breaking toolkit's framework-agnostic boundary
    - [fixed] Module-level mutable Map cache in discover-sources.ts persists across test runs and creates shared process state

Explore past review issues:
  desloppify show review --no-budget              # all open review issues
  desloppify show review --status deferred         # deferred issues

RELEVANT FINDINGS — explore with CLI:
These detectors found patterns related to this dimension. Explore the findings,
then read the actual source code.

  desloppify show cycles --no-budget      # 1 findings

Report actionable issues in issues[]. Use concern_verdict and concern_fingerprint
for findings you want to confirm or dismiss.

--- Batch 2: high_level_elegance ---
Rationale: high_level_elegance review
DIMENSION TO EVALUATE:

## high_level_elegance
Clear decomposition, coherent ownership, domain-aligned structure
Look for:
- Top-level packages/files map to domain capabilities rather than historical accidents
- Ownership and change boundaries are predictable — a new engineer can explain why this exists
- Public surface (exports/entry points) is small and consistent with stated responsibility
- Project contracts and reference docs match runtime reality (README/structure/philosophy are trustworthy)
- Subsystem decomposition localizes change without surprising ripple edits
- A small set of architectural patterns is used consistently across major areas
Skip:
- When dependency direction/cycle/hub failures are the PRIMARY issue, report under cross_module_architecture (still include here if they materially blur ownership/decomposition)
- When handoff mechanics are the PRIMARY issue, report under mid_level_elegance (still include here if they materially affect top-level role clarity)
- When function/class internals are the PRIMARY issue, report under low_level_elegance or logic_clarity
- Pure naming/style nits with no impact on role clarity

Previously flagged issues — navigation aid, not scoring evidence:
Check whether open issues still exist. Do not re-report resolved or deferred items.
If several past issues share a root cause, call that out.

  Resolved (2):
    - [fixed] feed-parser.ts is a shared parsing utility in tools/ rather than a proper utility/shared layer
    - [fixed] discoverSources() docstring says session is not required but function signature requires DemosSession

Explore past review issues:
  desloppify show review --no-budget              # all open review issues
  desloppify show review --status deferred         # deferred issues

--- Batch 3: convention_outlier ---
Rationale: convention_outlier review
DIMENSION TO EVALUATE:

## convention_outlier
Naming convention drift, inconsistent file organization, style islands
Look for:
- Naming convention drift: snake_case functions in a camelCase codebase or vice versa
- Inconsistent file organization that impedes navigation (not mere structural variation between dirs)
- Mixed export patterns across sibling modules (named vs default, class vs function)
- Style islands: one directory uses a completely different pattern than the rest
- Sibling modules following different behavioral protocols (e.g. most call a shared function, one doesn't)
- Inconsistent plugin organization: sibling plugins structured differently
- Large __init__.py re-export surfaces that obscure internal module structure
- Mixed type strategies for domain objects (TypedDict for some, dataclass for others, NamedTuple for yet others) without documented rationale — see type_strategy_census evidence
Skip:
- Intentional variation for different module types (config vs logic)
- Third-party code or generated files following their own conventions
- Do NOT recommend adding index/barrel files, re-export facades, or directory wrappers to 'standardize' — prefer the simpler existing pattern over consistency-for-its-own-sake
- When sibling modules use different structures, report the inconsistency but do NOT suggest adding abstraction layers to unify them

Previously flagged issues — navigation aid, not scoring evidence:
Check whether open issues still exist. Do not re-report resolved or deferred items.
If several past issues share a root cause, call that out.

  Resolved (2):
    - [fixed] pay-spend-cap.ts exports separate checkPaySpendCap/recordPayment functions alongside reservePaySpend, inconsistent with peers' checkAndRecord* pattern
    - [fixed] pay.ts contains an inline dynamic import of safeParse inside safeReadBody, breaking the static-imports-at-top convention

Explore past review issues:
  desloppify show review --no-budget              # all open review issues
  desloppify show review --status deferred         # deferred issues

RELEVANT FINDINGS — explore with CLI:
These detectors found patterns related to this dimension. Explore the findings,
then read the actual source code.

  desloppify show dupes --no-budget      # 1 findings
  desloppify show naming --no-budget      # 1 findings

Report actionable issues in issues[]. Use concern_verdict and concern_fingerprint
for findings you want to confirm or dismiss.

--- Batch 4: error_consistency ---
Rationale: error_consistency review
DIMENSION TO EVALUATE:

## error_consistency
Consistent error strategies, preserved context, predictable failure modes
Look for:
- Mixed error strategies: some functions throw, others return null, others use Result types
- Error context lost at boundaries: catch-and-rethrow without wrapping original
- Inconsistent error types: custom error classes in some modules, bare strings in others
- Silent error swallowing: catches that log but don't propagate or recover
- Missing error handling on I/O boundaries (file, network, parse operations)
Skip:
- Intentional error boundaries at top-level handlers
- Different strategies for different layers (e.g. Result in core, throw in CLI)

Previously flagged issues — navigation aid, not scoring evidence:
Check whether open issues still exist. Do not re-report resolved or deferred items.
If several past issues share a root cause, call that out.

  Resolved (2):
    - [fixed] connectSdk() wraps all internal exceptions as AUTH_FAILED regardless of actual failure cause
    - [fixed] sdk-bridge.ts apiCall() converts network errors to plain string, losing error type information

Explore past review issues:
  desloppify show review --no-budget              # all open review issues
  desloppify show review --status deferred         # deferred issues

RELEVANT FINDINGS — explore with CLI:
These detectors found patterns related to this dimension. Explore the findings,
then read the actual source code.

  desloppify show security --no-budget      # 6 findings
  desloppify show smells --no-budget      # 145 findings

Report actionable issues in issues[]. Use concern_verdict and concern_fingerprint
for findings you want to confirm or dismiss.

--- Batch 5: naming_quality ---
Rationale: naming_quality review
DIMENSION TO EVALUATE:

## naming_quality
Function/variable/file names that communicate intent
Look for:
- Generic verbs that reveal nothing: process, handle, do, run, manage
- Name/behavior mismatch: getX() that mutates state, isX() returning non-boolean
- Vocabulary divergence from codebase norms (context provides the norms)
- Abbreviations inconsistent with codebase conventions
Skip:
- Standard framework names (render, mount, useEffect)
- Short-lived loop variables (i, j, k)
- Well-known abbreviations matching codebase convention (ctx, req, res)
- Short names that are established project conventions used consistently — a name used 50+ times is a convention, not an outlier

Previously flagged issues — navigation aid, not scoring evidence:
Check whether open issues still exist. Do not re-report resolved or deferred items.
If several past issues share a root cause, call that out.

  Resolved (1):
    - [fixed] connectSdk() understates its responsibility — it loads wallet credentials, connects SDK, and authenticates, not just connects

Explore past review issues:
  desloppify show review --no-budget              # all open review issues
  desloppify show review --status deferred         # deferred issues

RELEVANT FINDINGS — explore with CLI:
These detectors found patterns related to this dimension. Explore the findings,
then read the actual source code.

  desloppify show naming --no-budget      # 1 findings

Report actionable issues in issues[]. Use concern_verdict and concern_fingerprint
for findings you want to confirm or dismiss.

--- Batch 6: abstraction_fitness ---
Rationale: abstraction_fitness review
DIMENSION TO EVALUATE:

## abstraction_fitness
TypeScript abstraction fitness: type and interface layers should improve safety and design clarity, not add ceremony or pass-through indirection.
Look for:
- Functions/components that only forward props or args without behavior, validation, or translation
- Interfaces/types with one implementation and no polymorphic usage pressure
- Large option objects passed through multiple layers with only a small subset used locally
- Generic helper abstractions with one concrete type usage in practice
- Cross-feature chains of wrappers that pass data unchanged between controller/service/helper layers
- Widespread one-implementation interface ecosystems that add naming ceremony without substitution value
Skip:
- React/Next.js framework composition patterns required by routing or lifecycle boundaries
- Wrappers that intentionally add auth, telemetry, caching, feature flags, or retries
- Public API typing shells that isolate external SDK volatility
- Intentional barrel/facade exports that define stable package entry points

Previously flagged issues — navigation aid, not scoring evidence:
Check whether open issues still exist. Do not re-report resolved or deferred items.
If several past issues share a root cause, call that out.

  Resolved (1):
    - [fixed] DemosSession exposes 12 public fields read directly by tools, making it a transparent property bag rather than a behavior-bearing session object

Explore past review issues:
  desloppify show review --no-budget              # all open review issues
  desloppify show review --status deferred         # deferred issues

RELEVANT FINDINGS — explore with CLI:
These detectors found patterns related to this dimension. Explore the findings,
then read the actual source code.

  desloppify show facade --no-budget      # 29 findings
  desloppify show props --no-budget      # 1 findings
  desloppify show single_use --no-budget      # 1 findings
  desloppify show structural --no-budget      # 5 findings

Report actionable issues in issues[]. Use concern_verdict and concern_fingerprint
for findings you want to confirm or dismiss.

--- Batch 7: dependency_health ---
Rationale: dependency_health review
DIMENSION TO EVALUATE:

## dependency_health
Unused deps, version conflicts, multiple libs for same purpose, heavy deps
Look for:
- Multiple libraries for the same purpose (e.g. moment + dayjs, axios + fetch wrapper)
- Heavy dependencies pulled in for light use (e.g. lodash for one function)
- Circular dependency cycles visible in the import graph
- Unused dependencies in package.json/requirements.txt
- Version conflicts or pinning issues visible in lock files
Skip:
- Dev dependencies (test, build, lint tools)
- Peer dependencies required by frameworks

Previously flagged issues — navigation aid, not scoring evidence:
Check whether open issues still exist. Do not re-report resolved or deferred items.
If several past issues share a root cause, call that out.

  Resolved (1):
    - [fixed] @anthropic-ai/sdk is a heavy production dep (~6MB) with zero direct imports in src/toolkit/ — burdens future toolkit packaging

Explore past review issues:
  desloppify show review --no-budget              # all open review issues
  desloppify show review --status deferred         # deferred issues

RELEVANT FINDINGS — explore with CLI:
These detectors found patterns related to this dimension. Explore the findings,
then read the actual source code.

  desloppify show cycles --no-budget      # 1 findings

Report actionable issues in issues[]. Use concern_verdict and concern_fingerprint
for findings you want to confirm or dismiss.

--- Batch 8: low_level_elegance ---
Rationale: low_level_elegance review
DIMENSION TO EVALUATE:

## low_level_elegance
Direct, precise function and class internals
Look for:
- Control flow is direct and intention-revealing; branches are necessary and distinct
- State mutation and side effects are explicit, local, and bounded
- Edge-case handling is precise without defensive sprawl
- Extraction level is balanced: avoids both monoliths and micro-fragmentation
- Helper extraction style is consistent across related modules
Skip:
- When file responsibility/package role is the PRIMARY issue, report under high_level_elegance
- When inter-module seam choreography is the PRIMARY issue, report under mid_level_elegance
- When dependency topology is the PRIMARY issue, report under cross_module_architecture
- Provable logic/type/error defects already captured by logic_clarity, type_safety, or error_consistency

Previously flagged issues — navigation aid, not scoring evidence:
Check whether open issues still exist. Do not re-report resolved or deferred items.
If several past issues share a root cause, call that out.

  Resolved (4):
    - [fixed] checkBlockedIpv4 destructures [a, b, c, d] but c and d are never used in any blocking condition
    - [fixed] verify.ts retry loop structure uses off-by-one index arithmetic and implicit fall-through that requires careful reading to verify correctness
    - [fixed] reservePaySpend duplicates the amount validation from checkPaySpendCap with identical logic and error messages
    - [fixed] scan() accepts a domain filter option but fetchFeed() silently ignores it in the API path

Explore past review issues:
  desloppify show review --no-budget              # all open review issues
  desloppify show review --status deferred         # deferred issues

--- Batch 9: mid_level_elegance ---
Rationale: mid_level_elegance review
DIMENSION TO EVALUATE:

## mid_level_elegance
Quality of handoffs and integration seams across modules and layers
Look for:
- Inputs/outputs across boundaries are explicit, minimal, and unsurprising
- Data translation at boundaries happens in one obvious place
- Error and lifecycle propagation across boundaries follows predictable patterns
- Orchestration reads as composition of collaborators, not tangled back-and-forth calls
- Integration seams avoid glue-code entropy (ad-hoc mappers and boundary conditionals)
Skip:
- When top-level decomposition/package shape is the PRIMARY issue, report under high_level_elegance
- When implementation craft inside one function/class is the PRIMARY issue, report under low_level_elegance
- Pure API/type contract defects with no seam design impact (belongs to contract_coherence)
- Standalone naming/style preferences that do not affect handoffs

Previously flagged issues — navigation aid, not scoring evidence:
Check whether open issues still exist. Do not re-report resolved or deferred items.
If several past issues share a root cause, call that out.

  Resolved (1):
    - [fixed] verify() silently returns unconfirmed for transactions outside the 50-post feed window — callers cannot distinguish 'not confirmed' from 'outside search window'

Explore past review issues:
  desloppify show review --no-budget              # all open review issues
  desloppify show review --status deferred         # deferred issues

--- Batch 10: test_strategy ---
Rationale: test_strategy review
DIMENSION TO EVALUATE:

## test_strategy
Untested critical paths, coupling, snapshot overuse, fragility patterns
Look for:
- Critical paths with zero test coverage (high-importer files, core business logic)
- Test-production coupling: tests that break when implementation details change
- Snapshot test overuse: >50% of tests are snapshot-based
- Missing integration tests: unit tests exist but no cross-module verification
- Test fragility: tests that depend on timing, ordering, or external state
Skip:
- Low-value files intentionally untested (types, constants, index files)
- Generated code that shouldn't have custom tests

RELEVANT FINDINGS — explore with CLI:
These detectors found patterns related to this dimension. Explore the findings,
then read the actual source code.

  desloppify show test_coverage --no-budget      # 91 findings

Report actionable issues in issues[]. Use concern_verdict and concern_fingerprint
for findings you want to confirm or dismiss.

--- Batch 11: api_surface_coherence ---
Rationale: api_surface_coherence review
DIMENSION TO EVALUATE:

## api_surface_coherence
Inconsistent API shapes, mixed sync/async, overloaded interfaces
Look for:
- Inconsistent API shapes: similar functions with different parameter ordering or naming
- Mixed sync/async in the same module's public API
- Overloaded interfaces: one function doing too many things based on argument types
- Missing error contracts: no documentation or types indicating what can fail
- Public functions with >5 parameters (API boundary may be wrong)
Skip:
- Internal/private APIs where flexibility is acceptable
- Framework-imposed patterns (React hooks must follow rules of hooks)

Previously flagged issues — navigation aid, not scoring evidence:
Check whether open issues still exist. Do not re-report resolved or deferred items.
If several past issues share a root cause, call that out.

  Still open (3):
    - [open] reply() validates input outside withToolWrapper — latencyMs=0 and session.touch() not called on validation failure
    - [open] ScanOptions.filters is accepted and typed but never read by scan()
    - [open] AttestOptions.claimType is accepted and typed but never read by attest()

Explore past review issues:
  desloppify show review --no-budget              # all open review issues
  desloppify show review --status deferred         # deferred issues

--- Batch 12: authorization_consistency ---
Rationale: authorization_consistency review
DIMENSION TO EVALUATE:

## authorization_consistency
Auth/permission patterns consistently applied across the codebase
Look for:
- Route handlers with auth decorators/middleware on some siblings but not others
- RLS enabled on some tables but not siblings in the same domain
- Permission strings as magic literals instead of shared constants
- Mixed trust boundaries: some endpoints validate user input, siblings don't
- Service role / admin bypass without audit logging or access control
Skip:
- Public routes explicitly documented as unauthenticated (health checks, login, webhooks)
- Internal service-to-service calls behind network-level auth
- Dev/test endpoints behind feature flags or environment checks

Previously flagged issues — navigation aid, not scoring evidence:
Check whether open issues still exist. Do not re-report resolved or deferred items.
If several past issues share a root cause, call that out.

  Still open (1):
    - [open] apiBaseUrl passed to createSdkBridge is not SSRF-validated — relative-path enforcement cannot protect against a malicious base URL

Explore past review issues:
  desloppify show review --no-budget              # all open review issues
  desloppify show review --status deferred         # deferred issues

--- Batch 13: ai_generated_debt ---
Rationale: ai_generated_debt review
DIMENSION TO EVALUATE:

## ai_generated_debt
LLM-hallmark patterns: restating comments, defensive overengineering, boilerplate
Look for:
- Restating comments that echo the code without adding insight (// increment counter above i++)
- Nosy debug logging: entry/exit logs on every function, full object dumps to console
- Defensive overengineering: null checks on non-nullable typed values, try-catch around pure expressions
- Docstring bloat: multi-line docstrings on trivial 2-line functions
- Pass-through wrapper functions with no added logic (just forward args to another function)
- Generic names in domain code: handleData, processItem, doOperation where domain terms exist
- Identical boilerplate error handling copied verbatim across multiple files
Skip:
- Comments explaining WHY (business rules, non-obvious constraints, external dependencies)
- Defensive checks at genuine API boundaries (user input, network, file I/O)
- Generated code (protobuf, GraphQL codegen, ORM migrations)
- Wrapper functions that add auth, logging, metrics, or caching

Previously flagged issues — navigation aid, not scoring evidence:
Check whether open issues still exist. Do not re-report resolved or deferred items.
If several past issues share a root cause, call that out.

  Still open (1):
    - [open] tool-wrapper.ts exports isDemosErrorLike() but the catch block uses isDemosError() from types — two functionally identical guards coexist

Explore past review issues:
  desloppify show review --no-budget              # all open review issues
  desloppify show review --status deferred         # deferred issues

--- Batch 14: incomplete_migration ---
Rationale: incomplete_migration review
DIMENSION TO EVALUATE:

## incomplete_migration
Old+new API coexistence, deprecated-but-called symbols, stale migration shims
Look for:
- Old and new API patterns coexisting: class+functional components, axios+fetch, moment+dayjs
- Deprecated symbols still called by active code (@deprecated, DEPRECATED markers)
- Compatibility shims that no caller actually needs anymore
- Mixed JS/TS files for the same module (incomplete TypeScript migration)
- Stale migration TODOs: TODO/FIXME referencing 'migrate', 'legacy', 'old api', 'remove after'
Skip:
- Active, intentional migrations with tracked progress
- Backward-compatibility for external consumers (published APIs, libraries)
- Gradual rollouts behind feature flags with clear ownership

Previously flagged issues — navigation aid, not scoring evidence:
Check whether open issues still exist. Do not re-report resolved or deferred items.
If several past issues share a root cause, call that out.

  Still open (2):
    - [open] Both CLI runners import deprecated legacy write-rate-limit instead of toolkit version
    - [open] 8 deprecated guard functions exported from index.ts without removal version/timeline

Explore past review issues:
  desloppify show review --no-budget              # all open review issues
  desloppify show review --status deferred         # deferred issues

RELEVANT FINDINGS — explore with CLI:
These detectors found patterns related to this dimension. Explore the findings,
then read the actual source code.

  desloppify show deprecated --no-budget      # 10 findings

Report actionable issues in issues[]. Use concern_verdict and concern_fingerprint
for findings you want to confirm or dismiss.

--- Batch 15: package_organization ---
Rationale: package_organization review
DIMENSION TO EVALUATE:

## package_organization
Directory layout quality and navigability: whether placement matches ownership and change boundaries
Look for:
- Use holistic_context.structure as objective evidence: root_files (fan_in/fan_out + role), directory_profiles (file_count/avg fan-in/out), and coupling_matrix (cross-directory edges)
- Straggler roots: root-level files with low fan-in (<5 importers) that share concern/theme with other files should move under a focused package
- Import-affinity mismatch: file imports/references are mostly from one sibling domain (>60%), but file lives outside that domain
- Coupling-direction failures: reciprocal/bidirectional directory edges or obvious downstream→upstream imports indicate boundary placement problems
- Flat directory overload: >10 files with mixed concerns and low cohesion should be split into purpose-driven subfolders
- Ambiguous folder naming: directory names do not reflect contained responsibilities
Skip:
- Root-level files that ARE genuinely core — high fan-in (≥5 importers), imported across multiple subdirectories (cli.py, state.py, utils.py, config.py)
- Small projects (<20 files) where flat structure is appropriate
- Framework-imposed directory layouts (src/, lib/, dist/, __pycache__/)
- Test directories mirroring production structure
- Aesthetic preferences without measurable navigation, ownership, or coupling impact

Previously flagged issues — navigation aid, not scoring evidence:
Check whether open issues still exist. Do not re-report resolved or deferred items.
If several past issues share a root cause, call that out.

  Still open (2):
    - [open] src/lib/ has 42 mixed-concern files in flat layout — 4x the 10-file cohesion threshold
    - [open] src/adapter-specs.ts is at src/ root despite src/adapters/ subdirectory existing

Explore past review issues:
  desloppify show review --no-budget              # all open review issues
  desloppify show review --status deferred         # deferred issues

RELEVANT FINDINGS — explore with CLI:
These detectors found patterns related to this dimension. Explore the findings,
then read the actual source code.

  desloppify show flat_dirs --no-budget      # 2 findings

Report actionable issues in issues[]. Use concern_verdict and concern_fingerprint
for findings you want to confirm or dismiss.

--- Batch 16: initialization_coupling ---
Rationale: initialization_coupling review
DIMENSION TO EVALUATE:

## initialization_coupling
Boot-order dependencies, import-time side effects, global singletons
Look for:
- Module-level code that depends on another module having been imported first
- Import-time side effects: DB connections, file I/O, network calls at module scope
- Global singletons where creation order matters across modules
- Environment variable reads at import time (fragile in testing)
- Circular init dependencies hidden behind conditional or lazy imports
- Module-level constants computed at import time alongside a dynamic getter function — consumers referencing the stale snapshot instead of calling the getter
Skip:
- Standard library initialization (logging.basicConfig)
- Framework bootstrap (app.configure, server.listen)

Previously flagged issues — navigation aid, not scoring evidence:
Check whether open issues still exist. Do not re-report resolved or deferred items.
If several past issues share a root cause, call that out.

  Still open (1):
    - [open] _isContainer module-level singleton in connect.ts reads FS at first call — fragile in test environments

Explore past review issues:
  desloppify show review --no-budget              # all open review issues
  desloppify show review --status deferred         # deferred issues

--- Batch 17: design_coherence ---
Rationale: design_coherence review
DIMENSION TO EVALUATE:

## design_coherence
Are structural design decisions sound — functions focused, abstractions earned, patterns consistent?
Look for:
- Functions doing too many things — multiple distinct responsibilities in one body
- Parameter lists that should be config/context objects — many related params passed together
- Files accumulating issues across many dimensions — likely mixing unrelated concerns
- Deep nesting that could be flattened with early returns or extraction
- Repeated structural patterns that should be data-driven
Skip:
- Functions that are long but have a single coherent responsibility
- Parameter lists where grouping would obscure meaning — do NOT recommend config/context objects or dependency injection wrappers just to reduce parameter count; only group when the grouping has independent semantic meaning
- Files that are large because their domain is genuinely complex, not because they mix concerns
- Nesting that is inherent to the problem (e.g., recursive tree processing)
- Do NOT recommend extracting callable parameters or injecting dependencies for 'testability' — direct function calls are simpler and preferred unless there is a concrete decoupling need

Mechanical concern signals — investigate and adjudicate:
Overview (39 signals):
  design_concern: 38 — src/actions/action-executor.ts, src/actions/attestation-executor.ts, ...
  duplication_design: 1 — src/actions/publish-pipeline.ts

For each concern, read the source code and report your verdict in issues[]:
  - Confirm → full issue object with concern_verdict: "confirmed"
  - Dismiss → minimal object: {concern_verdict: "dismissed", concern_fingerprint: "<hash>"}
    (only these 2 fields required — add optional reasoning/concern_type/concern_file)
  - Unsure → skip it (will be re-evaluated next review)

  - [design_concern] src/actions/action-executor.ts
    summary: Design signals from props, smells
    question: Review the flagged patterns — are they design problems that need addressing, or acceptable given the file's role?
    evidence: Flagged by: props, smells
    evidence: [props] Bloated context: ActionExecutorContext (22 fields)
    fingerprint: 789b77d6e00c7f71
  - [design_concern] src/actions/attestation-executor.ts
    summary: Design signals from orphaned, smells
    question: Is this file truly dead, or is it used via a non-import mechanism (dynamic import, CLI entry point, plugin)?
    evidence: Flagged by: orphaned, smells
    evidence: [orphaned] Orphaned file (119 LOC): zero importers, not an entry point
    fingerprint: 56951e0173d7bbe2
  - [design_concern] src/actions/omniweb-action-executor.ts
    summary: Design signals from orphaned, smells
    question: Is this file truly dead, or is it used via a non-import mechanism (dynamic import, CLI entry point, plugin)?
    evidence: Flagged by: orphaned, smells
    evidence: [orphaned] Orphaned file (292 LOC): zero importers, not an entry point
    fingerprint: 70a8ee38a3104623
  - [design_concern] src/lib/agent-config.ts
    summary: Design signals from smells, structural
    question: Review the flagged patterns — are they design problems that need addressing, or acceptable given the file's role?
    evidence: Flagged by: smells, structural
    evidence: File size: 571 lines
    fingerprint: af6c057c655beeab
  - [design_concern] src/lib/auth/auth.ts
    summary: Design signals from smells
    question: Review the flagged patterns — are they design problems that need addressing, or acceptable given the file's role?
    evidence: Flagged by: smells
    evidence: [smells] 1x Explicit `any` types
    fingerprint: 22c9fe28927b7293
  - [design_concern] src/lib/auth/identity.ts
    summary: Design signals from smells
    question: Review the flagged patterns — are they design problems that need addressing, or acceptable given the file's role?
    evidence: Flagged by: smells
    evidence: [smells] 2x Async functions without await
    fingerprint: cb78d1ddd778e305
  - [design_concern] src/lib/colony-intelligence.ts
    summary: Design signals from orphaned, smells
    question: Is this file truly dead, or is it used via a non-import mechanism (dynamic import, CLI entry point, plugin)?
    evidence: Flagged by: orphaned, smells
    evidence: [orphaned] Orphaned file (237 LOC): zero importers, not an entry point
    fingerprint: c2acb5cd2a1f0f19
  - [design_concern] src/lib/extensions.ts
    summary: Design signals from cycles, facade
    question: Review the flagged patterns — are they design problems that need addressing, or acceptable given the file's role?
    evidence: Flagged by: cycles, facade
    evidence: [cycles] Import cycle (3 files): src/lib/extensions.ts -> src/lib/util/extensions.ts -> src/plugins/calibrate-plugin.ts
    fingerprint: 1bf40c4f8c2f4c43
  - [design_concern] src/lib/llm/llm-provider.ts
    summary: Design signals from smells
    question: Review the flagged patterns — are they design problems that need addressing, or acceptable given the file's role?
    evidence: Flagged by: smells
    evidence: [smells] 2x Explicit `any` types
    fingerprint: 3d5d087c1b8b1df7
  - [design_concern] src/lib/mentions.ts
    summary: Design signals from orphaned, smells
    question: Is this file truly dead, or is it used via a non-import mechanism (dynamic import, CLI entry point, plugin)?
    evidence: Flagged by: orphaned, smells
    evidence: [orphaned] Orphaned file (148 LOC): zero importers, not an entry point
    fingerprint: 2c54138f0c5c11b9
  - [design_concern] src/lib/network/sdk.ts
    summary: Design signals from smells
    question: Review the flagged patterns — are they design problems that need addressing, or acceptable given the file's role?
    evidence: Flagged by: smells
    evidence: [smells] 1x Catch block returns default object (silent failure)
    fingerprint: d2b0d8fa890b94fe
  - [design_concern] src/lib/network/skill-dojo-client.ts
    summary: Design signals from smells
    question: Review the flagged patterns — are they design problems that need addressing, or acceptable given the file's role?
    evidence: Flagged by: smells
    evidence: [smells] 1x Catch block returns default object (silent failure)
    fingerprint: 560639143b64bef0
  - [design_concern] src/lib/network/storage-client.ts
    summary: Design signals from smells
    question: Review the flagged patterns — are they design problems that need addressing, or acceptable given the file's role?
    evidence: Flagged by: smells
    evidence: [smells] 2x Async functions without await
    fingerprint: 6b237a55a1b29239
  - [design_concern] src/lib/pipeline/signal-detection.ts
    summary: Design signals from smells, structural
    question: Review the flagged patterns — are they design problems that need addressing, or acceptable given the file's role?
    evidence: Flagged by: smells, structural
    evidence: File size: 838 lines
    fingerprint: dacb3f9aecca3888
  - [design_concern] src/lib/pipeline/signals.ts
    summary: Design signals from smells
    question: Review the flagged patterns — are they design problems that need addressing, or acceptable given the file's role?
    evidence: Flagged by: smells
    evidence: [smells] 4x Explicit `any` types
    fingerprint: 99037fdeeada6bb8
  - [design_concern] src/lib/pipeline/source-discovery.ts
    summary: Design signals from smells
    question: Review the flagged patterns — are they design problems that need addressing, or acceptable given the file's role?
    evidence: Flagged by: smells
    evidence: [smells] 4x Explicit `any` types
    fingerprint: 66c05d8b32241962
  - [design_concern] src/lib/pipeline/source-scanner.ts
    summary: Design signals from smells
    question: Review the flagged patterns — are they design problems that need addressing, or acceptable given the file's role?
    evidence: Flagged by: smells
    evidence: [smells] 2x Async functions without await
    fingerprint: ef41e3143935c0a6
  - [design_concern] src/lib/sources/catalog.ts
    summary: Design signals from smells, structural
    question: Review the flagged patterns — are they design problems that need addressing, or acceptable given the file's role?
    evidence: Flagged by: smells, structural
    evidence: File size: 698 lines
    fingerprint: 30acfec8d79eb576
  - [design_concern] src/lib/sources/fetch.ts
    summary: Design signals from smells
    question: Review the flagged patterns — are they design problems that need addressing, or acceptable given the file's role?
    evidence: Flagged by: smells
    evidence: [smells] 1x Async functions without await
    fingerprint: e378e7a3c2494497
  - [design_concern] src/lib/sources/health.ts
    summary: Design signals from smells
    question: Review the flagged patterns — are they design problems that need addressing, or acceptable given the file's role?
    evidence: Flagged by: smells
    evidence: [smells] 1x Catch block returns default object (silent failure)
    fingerprint: 09c163c567167a97
  - [design_concern] src/lib/sources/lifecycle.ts
    summary: Design signals from smells
    question: Review the flagged patterns — are they design problems that need addressing, or acceptable given the file's role?
    evidence: Flagged by: smells
    evidence: [smells] 1x High cyclomatic complexity (>15 branches)
    fingerprint: 5d9cd2397d3dc949
  - [design_concern] src/lib/sources/matcher.ts
    summary: Design signals from smells, structural
    question: Review the flagged patterns — are they design problems that need addressing, or acceptable given the file's role?
    evidence: Flagged by: smells, structural
    evidence: File size: 644 lines
    fingerprint: 7b49bcb14b7d7fb7
  - [design_concern] src/lib/sources/providers/declarative-engine.ts
    summary: Design signals from smells, structural
    question: Review the flagged patterns — are they design problems that need addressing, or acceptable given the file's role?
    evidence: Flagged by: smells, structural
    evidence: File size: 1534 lines
    fingerprint: 8fe08273429d1159
  - [design_concern] src/lib/state.ts
    summary: Design signals from smells
    question: Review the flagged patterns — are they design problems that need addressing, or acceptable given the file's role?
    evidence: Flagged by: smells
    evidence: [smells] 8x `as any` type casts
    fingerprint: 15c25f166a4753c3
  - [design_concern] src/lib/tips.ts
    summary: Design signals from orphaned, smells
    question: Is this file truly dead, or is it used via a non-import mechanism (dynamic import, CLI entry point, plugin)?
    evidence: Flagged by: orphaned, smells
    evidence: [orphaned] Orphaned file (443 LOC): zero importers, not an entry point
    fingerprint: c59f6576bc09e56b
  - [design_concern] src/lib/tlsn-playwright-bridge.ts
    summary: Design signals from smells
    question: Review the flagged patterns — are they design problems that need addressing, or acceptable given the file's role?
    evidence: Flagged by: smells
    evidence: [smells] 13x `as any` type casts
    fingerprint: f66bc965a2bac8a7
  - [design_concern] src/lib/transcript.ts
    summary: Design signals from orphaned, smells
    question: Is this file truly dead, or is it used via a non-import mechanism (dynamic import, CLI entry point, plugin)?
    evidence: Flagged by: orphaned, smells
    evidence: [orphaned] Orphaned file (175 LOC): zero importers, not an entry point
    fingerprint: 3d0801ef220d2211
  - [design_concern] src/lib/tx-queue.ts
    summary: Design signals from orphaned, smells
    question: Is this file truly dead, or is it used via a non-import mechanism (dynamic import, CLI entry point, plugin)?
    evidence: Flagged by: orphaned, smells
    evidence: [orphaned] Orphaned file (121 LOC): zero importers, not an entry point
    fingerprint: 5fcdccdddd9fd01a
  - [design_concern] src/lib/util/subprocess.ts
    summary: Design signals from smells
    question: Review the flagged patterns — are they design problems that need addressing, or acceptable given the file's role?
    evidence: Flagged by: smells
    evidence: [smells] 1x Async functions without await
    fingerprint: 0620270d5f20ffc3
  - [design_concern] src/plugins/budget-plugin.ts
    summary: Design signals from orphaned, smells
    question: Is this file truly dead, or is it used via a non-import mechanism (dynamic import, CLI entry point, plugin)?
    evidence: Flagged by: orphaned, smells
    evidence: [orphaned] Orphaned file (58 LOC): zero importers, not an entry point
    fingerprint: cf10efae213ddd3b
  (+9 more — use `desloppify show <detector> --no-budget` to explore)

RELEVANT FINDINGS — explore with CLI:
These detectors found patterns related to this dimension. Explore the findings,
then read the actual source code.

  desloppify show cycles --no-budget      # 1 findings
  desloppify show dupes --no-budget      # 1 findings
  desloppify show facade --no-budget      # 1 findings
  desloppify show orphaned --no-budget      # 11 findings
  desloppify show props --no-budget      # 1 findings
  desloppify show smells --no-budget      # 139 findings
  desloppify show structural --no-budget      # 5 findings
  desloppify show unused --no-budget      # 26 findings

Report actionable issues in issues[]. Use concern_verdict and concern_fingerprint
for findings you want to confirm or dismiss.

--- Batch 18: contract_coherence ---
Rationale: contract_coherence review
DIMENSION TO EVALUATE:

## contract_coherence
Functions and modules that honor their stated contracts
Look for:
- Return type annotation lies: declared type doesn't match all return paths
- Docstring/signature divergence: params described in docs but not in function signature
- Functions named getX that mutate state (side effect hidden behind getter name)
- Module-level API inconsistency: some exports follow a pattern, one doesn't
- Error contracts: function says it throws but silently returns None, or vice versa
Skip:
- Protocol/interface stubs (abstract methods with placeholder returns)
- Test helpers where loose typing is intentional
- Overloaded functions with multiple valid return types

Previously flagged issues — navigation aid, not scoring evidence:
Check whether open issues still exist. Do not re-report resolved or deferred items.
If several past issues share a root cause, call that out.

  Still open (1):
    - [open] getWriteRateRemaining() reads unpruned state without a lock — may return different count than checkAndRecordWrite would compute

Explore past review issues:
  desloppify show review --no-budget              # all open review issues
  desloppify show review --status deferred         # deferred issues

--- Batch 19: logic_clarity ---
Rationale: logic_clarity review
DIMENSION TO EVALUATE:

## logic_clarity
Control flow and logic that provably does what it claims
Look for:
- Identical if/else or ternary branches (same code on both sides)
- Dead code paths: code after unconditional return/raise/throw/break
- Always-true or always-false conditions (e.g. checking a constant)
- Redundant null/undefined checks on values that cannot be null
- Async functions that never await (synchronous wrapped in async)
- Boolean expressions that simplify: `if x: return True else: return False`
Skip:
- Deliberate no-op branches with explanatory comments
- Framework lifecycle methods that must be async by contract
- Guard clauses that are defensive by design

Previously flagged issues — navigation aid, not scoring evidence:
Check whether open issues still exist. Do not re-report resolved or deferred items.
If several past issues share a root cause, call that out.

  Still open (1):
    - [open] verify() returns ok({confirmed:false}) after all retries exhaust without error — callers may not distinguish from a definitive 'not confirmed' vs 'gave up checking'

Explore past review issues:
  desloppify show review --no-budget              # all open review issues
  desloppify show review --status deferred         # deferred issues

RELEVANT FINDINGS — explore with CLI:
These detectors found patterns related to this dimension. Explore the findings,
then read the actual source code.

  desloppify show logs --no-budget      # 6 findings
  desloppify show smells --no-budget      # 145 findings
  desloppify show structural --no-budget      # 5 findings

Report actionable issues in issues[]. Use concern_verdict and concern_fingerprint
for findings you want to confirm or dismiss.

--- Batch 20: type_safety ---
Rationale: type_safety review
DIMENSION TO EVALUATE:

## type_safety
Type annotations that match runtime behavior
Look for:
- Return type annotations that don't cover all code paths (e.g., -> str but can return None)
- Parameters typed as X but called with Y (e.g., str param receiving None)
- Union types that could be narrowed (Optional used where None is never valid)
- Missing annotations on public API functions
- Type: ignore comments without explanation
- TypedDict fields marked Required but accessed via .get() with defaults — the type promises a shape the code doesn't trust
- Parameters typed as dict[str, Any] where a specific TypedDict or dataclass exists
- Enum types defined in the codebase but bypassed with raw string or int literal comparisons — see enum_bypass_patterns evidence
- Parallel type definitions: a Literal alias that duplicates an existing enum's values
Skip:
- Untyped private helpers in well-typed modules
- Dynamic framework code where typing is impractical
- Test code with loose typing

Previously flagged issues — navigation aid, not scoring evidence:
Check whether open issues still exist. Do not re-report resolved or deferred items.
If several past issues share a root cause, call that out.

  Still open (2):
    - [open] discover-sources.ts parses catalog entries with 8 inline Record<string,unknown> casts — no typed interface or Zod schema for catalog structure
    - [open] fetchWithValidatedRedirects in pay.ts has no explicit return type annotation

Explore past review issues:
  desloppify show review --no-budget              # all open review issues
  desloppify show review --status deferred         # deferred issues

## Execution Constraints

Never suggest changes that:
- Do not extract code into new files or functions that would have exactly 1 consumer
- Do not use __internal or _test export hacks — test through the public API or export properly
- Do not rename for convention alone when no ambiguity exists
- Do not delete tests without equivalent replacement coverage
- Do not strip rationale comments — preserve comments explaining why, not what
- Refactors must preserve behavior — do not change test expectations in cleanup steps
- Net line count must decrease or stay flat in cleanup commitsYOUR TASK: Read the code for this batch's dimension. Judge how well the codebase serves a developer from that perspective. The dimension rubric above defines what good looks like. Cite specific observations that explain your judgment.

Mechanical scan evidence — navigation aid, not scoring evidence:
The blind packet contains `holistic_context.scan_evidence` with aggregated signals from all mechanical detectors — including complexity hotspots, error hotspots, signal density index, boundary violations, and systemic patterns. Use these as starting points for where to look beyond the seed files.

Phase 1 — Observe:
1. Read the blind packet's `system_prompt` — scoring rules and calibration.
2. Study the dimension rubric (description, look_for, skip).
3. Review the existing characteristics list — which are settled? Which are positive? What needs updating?
4. Explore the codebase freely. Use scan evidence, historical issues, and mechanical findings as navigation aids.
5. Adjudicate mechanical concern signals (confirm/dismiss with fingerprint).
6. Augment the characteristics list via context_updates: positive patterns (positive: true), neutral characteristics, design insights.
7. Collect defects for issues[].
8. Respect scope controls: exclude files/directories marked by `exclude`, `suppress`, or non-production zone overrides.
9. Output a Phase 1 summary: list ALL characteristics for this dimension (existing + new, mark [+] for positive) and all defects collected. This is your consolidated reference for Phase 2.

Phase 2 — Judge (after Phase 1 is complete):
10. Keep issues and scoring scoped to this batch's dimension.
11. Return 0-200 issues for this batch (empty array allowed).
12. For package_organization, ground scoring in objective structure signals from `holistic_context.structure` (root_files fan_in/fan_out roles, directory_profiles, coupling_matrix). Prefer thresholded evidence (for example: fan_in < 5 for root stragglers, import-affinity > 60%, directories > 10 files with mixed concerns).
13. Suggestions must include a staged reorg plan (target folders, move order, and import-update/validation commands).
14. Also consult `holistic_context.structure.flat_dir_issues` for directories flagged as overloaded, fragmented, or thin-wrapper patterns.
15. For abstraction_fitness, use evidence from `holistic_context.abstractions`:
16. - `delegation_heavy_classes`: classes where most methods forward to an inner object — entries include class_name, delegate_target, sample_methods, and line number.
17. - `facade_modules`: re-export-only modules with high re_export_ratio — entries include samples (re-exported names) and loc.
18. - `typed_dict_violations`: TypedDict fields accessed via .get()/.setdefault()/.pop() — entries include typed_dict_name, violation_type, field, and line number.
19. - `complexity_hotspots`: files where mechanical analysis found extreme parameter counts, deep nesting, or disconnected responsibility clusters.
20. Include `delegation_density`, `definition_directness`, and `type_discipline` alongside existing sub-axes in dimension_notes when evidence supports it.
21. For initialization_coupling, use evidence from `holistic_context.scan_evidence.mutable_globals` and `holistic_context.errors.mutable_globals`. Investigate initialization ordering dependencies, coupling through shared mutable state, and whether state should be encapsulated behind a proper registry/context manager.
22. For design_coherence, use evidence from `holistic_context.scan_evidence.signal_density` — files where multiple mechanical detectors fired. Investigate what design change would address multiple signals simultaneously. Check `scan_evidence.complexity_hotspots` for files with high responsibility cluster counts.
23. For error_consistency, use evidence from `holistic_context.errors.exception_hotspots` — files with concentrated exception handling issues. Investigate whether error handling is designed or accidental. Check for broad catches masking specific failure modes.
24. For cross_module_architecture, also consult `holistic_context.coupling.boundary_violations` for import paths that cross architectural boundaries, and `holistic_context.dependencies.deferred_import_density` for files with many function-level imports (proxy for cycle pressure).
25. For convention_outlier, also consult `holistic_context.conventions.duplicate_clusters` for cross-file function duplication and `conventions.naming_drift` for directory-level naming inconsistency.
26. Workflow integrity checks: when reviewing orchestration/queue/review flows,
27. xplicitly look for loop-prone patterns and blind spots:
28. - repeated stale/reopen churn without clear exit criteria or gating,
29. - packet/batch data being generated but dropped before prompt execution,
30. - ranking/triage logic that can starve target-improving work,
31. - reruns happening before existing open review work is drained.
32. If found, propose concrete guardrails and where to implement them.
33. Complete `dimension_judgment`: write dimension_character (synthesizing characteristics and defects) then score_rationale. Set the score LAST.
34. Output context_updates with your Phase 1 observations. Use `add` with a clear header (5-10 words) and description (1-3 sentences focused on WHY, not WHAT). Positive patterns get `positive: true`. New insights can be `settled: true` when confident. Use `settle` to promote existing unsettled insights. Use `remove` for insights no longer true. Omit context_updates if no changes.
35. Do not edit repository files.
36. Return ONLY valid JSON, no markdown fences.

Scope enums:
- impact_scope: "local" | "module" | "subsystem" | "codebase"
- fix_scope: "single_edit" | "multi_file_refactor" | "architectural_change"

Output schema:
{
  "session": {"id": "<preserve from template>", "token": "<preserve from template>"},
  "assessments": {"<dimension>": <0-100 with one decimal place>},
  "dimension_notes": {
    "<dimension>": {
      "evidence": ["specific code observations"],
      "impact_scope": "local|module|subsystem|codebase",
      "fix_scope": "single_edit|multi_file_refactor|architectural_change",
      "confidence": "high|medium|low"
    }
  },
  "dimension_judgment": {
    "<dimension>": {
      "dimension_character": "2-3 sentences characterizing the overall nature of this dimension, synthesizing both positive characteristics and defects",
      "score_rationale": "2-3 sentences explaining the score, referencing global anchors"
    }
  },
  "issues": [{
    "dimension": "<dimension>",
    "identifier": "short_id",
    "summary": "one-line defect summary",
    "related_files": ["relative/path.py"],
    "evidence": ["specific code observation"],
    "suggestion": "concrete fix recommendation",
    "confidence": "high|medium|low",
    "impact_scope": "local|module|subsystem|codebase",
    "fix_scope": "single_edit|multi_file_refactor|architectural_change",
    "root_cause_cluster": "optional_cluster_name",
    "concern_verdict": "confirmed|dismissed  // for concern signals only",
    "concern_fingerprint": "abc123  // required when dismissed; copy from signal fingerprint",
    "reasoning": "why dismissed  // optional, for dismissed only"
  }],
  "context_updates": {
    "<dimension>": {
      "add": [{"header": "short label", "description": "why this is the way it is", "settled": true|false, "positive": true|false}],
      "remove": ["header of insight to remove"],
      "settle": ["header of insight to mark as settled"],
      "unsettle": ["header of insight to unsettle"]
    }  // omit or leave empty when no context changes
  }
}

Session requirements:
1. Keep `session.id` exactly `ext_20260328_071616_85056e23`.
2. Keep `session.token` exactly `b4d90bec5a6d81d0894aef14ab0a9b8f`.
3. Do not include provenance metadata (CLI injects canonical provenance).

