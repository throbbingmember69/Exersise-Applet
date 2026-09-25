# Exercise Applet

Offline-first, installable PWA (Android phone) for logging workouts, bodyweight and nutrition. It applies the double-progression, volume, nutrition and weekly check-in rules from `Training & Bulk Cut Plan Findings and Applet Spec.md`. Single user, all data on-device in IndexedDB. Hosted on GitHub Pages at `/Exersise-Applet/`.

## Source of truth (read before designing anything)
- `docs/DECISIONS.md`: binding user decisions, adopted defaults, and the 55 spec-audit findings. It wins over everything else.
- `docs/DESIGN.md`: the detailed design (schema, algorithm contracts, screens, milestones).
- `docs/PLAN.md`: the approved plan.
- The spec `.md` at the repo root: rules, seed data and acceptance criteria.

Ask the user before making architectural decisions not covered by these docs.

## Commands
Node isn't on PATH in some shells on this machine. Prefix bash commands with `export PATH="/c/Program Files/nodejs:$PATH"`.

- `npm run dev` / `npm run build` / `npm run preview`
- `npm test`: Vitest projects `domain` (node), `db` (node + fake-indexeddb), `ui` (happy-dom). Run one with `npx vitest run --project domain`.
- `npm run lint`, `npm run typecheck`, `npm run check` (lint + typecheck + test)
- `npm run e2e`: Playwright smoke tests against `vite preview`

## Architecture rules
- **`src/domain/` and `src/seed/` are pure.** No React, Dexie, DOM, or app-layer imports. No `Date.now()`, argument-less `new Date()` or `Math.random()`; "now"/"today" is always a parameter. ESLint enforces this.
- **The UI goes through `src/services/`** for reads (functions used with `useLiveQuery`) and writes. `features/` and `ui/` never import `@/db` or `dexie` (ESLint enforces this). Services take a `ServiceCtx` (`db`, `now`, `newId`) from `services/context.ts`, so tests use `createTestCtx()`.
- **Mass is stored in lb at full precision.** Only formatters in `domain/units.ts` round. kg is display-only.
- **Dates are local `YYYY-MM-DD` strings** (`LocalDate`), with day math via `domain/dates.ts`. Never `new Date('YYYY-MM-DD')` (it parses as UTC).
- **Every tunable number lives in `domain/settings/registry.ts`,** tagged Evidence/Heuristic and editable. No magic numbers in engine code.
- **History is never overwritten.** Finished sessions change only through explicit Edit mode (`db/guards.ts`). `sessionExercises` snapshots are immutable. Deletes are soft (`voidedAt`). Suggestions, stalls and targets are derived by replaying history, never stored as mutable state.
- **Dexie:** compute first, then write in one transaction. Never await non-Dexie promises inside a transaction. Never index booleans or nulls. Keep every old `db.version(n)` declaration.

## Testing
- Every domain change comes with Vitest tests next to the module (`foo.ts` → `foo.test.ts`).
- The spec's acceptance criteria each have a named test (see "Verification" in `docs/PLAN.md`). Keep them green.
- Seed-dependent numbers (volume totals, nutrition targets) are asserted against the spec's tables.

## Library notes (versions are newer than many examples online)
- react-router **8**: import from `react-router` (hash router: `createHashRouter` + `RouterProvider`).
- Vite **8** (Rolldown), Vitest **5** (`test.projects` in `vitest.config.ts`), TypeScript **6** (`types` must be listed explicitly in tsconfig), ESLint **10** flat config.
- Import local TS files with extensions only in config files. App code uses extensionless imports and the `@/` alias for `src/`.
