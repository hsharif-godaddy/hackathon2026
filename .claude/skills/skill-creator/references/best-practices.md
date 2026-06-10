# Authoring Best Practices

## Degrees of Freedom

Match instruction specificity to how fragile the outcome is:

- **High freedom** (describe intent, let model choose): styling, naming,
  file organization, code review approaches. Multiple paths are valid.
- **Medium freedom** (provide pattern with flexibility): API integration,
  component structure, data flows. A preferred approach exists but
  adaptation is acceptable.
- **Low freedom** (exact steps, no deviation): security configurations,
  payment flows, data migrations. Operations are fragile and consistency
  is critical.

## Avoid Deeply Nested References

A skill body may load bundled resources (Layer 3), but those resources
must not reference further files. Keep indirection to one level from
skill.md. If a resource needs its own sub-resources, it should be a
separate skill.

## Feedback Loops

For skills that produce verifiable output, include a validate-fix-repeat
cycle:
1. Execute the action
2. Run a check (typecheck, lint, API response, test suite)
3. If it fails, fix and re-run from step 1

Do not leave error recovery to the user. The skill should encode the
validation loop explicitly.

## Verifiable Intermediate Outputs

For multi-step workflows, each stage should produce output the agent can
confirm before proceeding (plan-validate-execute). This prevents
cascading errors in later steps. Use when: batch operations, destructive
changes, complex validation rules, high-stakes operations.

## Consistent Terminology

Choose one term for each concept and use it throughout the skill. Define
domain-specific terms at first use. Do not alternate between synonyms
(e.g., pick "component" or "widget", not both interchangeably).

## Model Awareness

Write skills for Sonnet-class models (balanced guidance). Progressive
disclosure layers handle scaling: Haiku-class models benefit from more
explicit step-by-step structure in sections, while Opus-class models
benefit from reasoning context in the body. Do not over-explain concepts
the model already knows.

## Solve, Don't Punt

When a skill includes scripts, handle error conditions in the script
rather than hoping the agent figures it out. Provide explicit fallbacks.
Document configuration parameters with justification to avoid "voodoo
constants."
