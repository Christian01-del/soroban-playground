## Summary

Fixes the critical DoS vulnerability where complex nested GraphQL queries could consume 100% CPU on the indexer server.

Two independent, defence-in-depth guards are applied **before any resolver fires**:

1. **`limit_depth(MAX_QUERY_DEPTH)`** — async-graphql's built-in depth cap (8 levels).
2. **`limit_complexity(MAX_COMPLEXITY)`** — async-graphql's built-in complexity cap (100 points).
3. **`DepthLimiter` extension** — custom AST-walking `Extension` that parses the incoming document and returns a structured error if depth exceeds `MAX_QUERY_DEPTH`. This is a belt-and-suspenders guard that fires at the `parse_query` hook, independently of the schema-builder limits.

All limits are declared as public constants in a single file so they can be adjusted in one place.

## Files Changed

| File | Change |
|------|--------|
| `indexer/src/graphql/limits.rs` | **New** — `MAX_QUERY_DEPTH`, `MAX_COMPLEXITY`, `selection_set_depth()`, `DepthLimiter` extension + full test suite |
| `indexer/src/graphql/mod.rs` | Added `pub mod limits` and re-exports |
| `indexer/src/graphql/schema.rs` | Wired `.limit_depth()`, `.limit_complexity()`, `.extension(DepthLimiter)` |

## Tests

14 tests added in `indexer/src/graphql/limits.rs`:

**Unit tests (depth calculator):**
- Single scalar field → depth 1
- Multiple flat fields → depth 1
- Nested object → depth 2
- Three levels → depth 3
- Four levels → depth 4
- Deepest branch wins
- Exactly `MAX_QUERY_DEPTH` is accepted
- `MAX_QUERY_DEPTH + 1` is measured correctly

**Integration tests (full schema):**
- Shallow query passes
- Query at depth 2 passes
- Query exceeding depth is rejected with an error
- Low-complexity query passes
- High-complexity query (105 > 100) is rejected
- Exact boundary (100 = 100) is accepted
- Empty / introspection query does not panic
- Named operation is evaluated correctly
- Two-field complexity sums correctly

## Impact

Resolves the production stability risk: any query that would previously spin the CPU is now rejected at the HTTP handler boundary with a clear `400`-equivalent GraphQL error, before touching the database.

Closes #1372
