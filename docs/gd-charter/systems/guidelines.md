# Engineering Guidelines

These are strongly encouraged heuristics for code and system design, not strict policy. Nothing below assumes automated enforcement via linting, typechecking, or CI.

## Types

- All local variables, function parameters, and function return types should have explicit type annotations.
- Avoid `any`. Prefer primitive types, union types, type aliases, interfaces, generics, classes, enums, or `unknown` when the value is genuinely opaque at a boundary.

## Constrain mutable state

- Minimize mutable state. Confine mutation to narrow, well-defined boundaries.
- Prefer immutable data flows across architectural boundaries (service, module, API surface). Once data crosses a boundary, treat it as immutable.
- Closures over mutable bindings are a distinct hazard: a function that captures a `let` from an enclosing scope becomes dependent on mutation timing from elsewhere, which is hard to reason about, hard to test, and a common source of async races. Prefer closing over `const` bindings; if the value genuinely needs to change, pass it as an argument at call time rather than reading it from the enclosing scope.
- TypeScript-specific heuristic: favor `const` over `let`. The easy case is a binding that isn't reassigned as written — use `const`. The harder case is code structured so that `let` appears necessary when it isn't: module-level state with deferred null-then-assign initialization, class fields hydrated later, or `let` hoisted above a block to capture a value from conditional branches. In those cases, restructure so `const` works — eager init, dependency injection, or extracting a function that returns the value — rather than accepting the `let`. Reserve `let` for tactical local reassignment such as loop counters and small-scope accumulators.
