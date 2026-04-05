# Project Rules

> Short, actionable rules and conventions for this project. Loaded automatically by /aif-implement.

## Rules

- Every package must maintain at least 70% test coverage (measured by @vitest/coverage-v8)
- Write code following SOLID and DRY principles
- Always run linter after implementation: `npm run lint`
- Always run tests after implementation: `npm test`
- Always verify the project builds successfully after changes: `npm run build`
- Always check test coverage after implementation and ensure it meets the 70% threshold
- **Reuse existing UI components** from `packages/web/src/components/ui/` before creating new ones. Compose primitives (Dialog + Button, etc.) instead of writing new wrappers.
- **Sync new UI components with Pencil.** Any new visual component must have a corresponding design in the Pencil design system (`.pen` files). Use `pencil` MCP tools (`batch_design`, `get_guidelines`) to create or update the design representation.
