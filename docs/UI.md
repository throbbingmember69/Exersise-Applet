# UI conventions

Rules every screen follows so the app feels like one product. The design brief: a fast, calm gym tool you use one-handed between sets, on an Android phone (360–412 px wide), often in bad light.

## Structure
- **Screens** live in `src/features/<feature>/` and are the default export of the file that `src/routes.tsx` lazy-loads. Keep route files thin; put sub-components next to them.
- **Data:** read with `useLive((ctx) => someQuery(ctx, args), [args…])` from `@/app/hooks`, and write with `useCommand(someCommand, { success?: 'Saved' })`. Never import `@/db` or `dexie` (ESLint blocks it). Pass today's date from `useToday()` into queries that take `today`/`asOf`, because queries never read the clock.
- **Units:** `useUnits()` gives `'lb' | 'kg'`. Show masses with `formatMass` / `formatMassWithUnit` from `@/domain/units`, and take mass input with `<MassInput>`, which stores lb.
- **Tests:** use `renderScreen(<Screen />, { route, path, ctx })` from `@/app/testing` with `createTestCtx()` data. Seed history with `insertSession` (`@/services/training/testFixtures`) or the real service commands. Assert what the user sees (roles and text).

## Layout
- Every screen starts with `<PageHeader title back? actions? />`. Secondary screens pass `back` (the parent route).
- Content is a vertical `<Stack>` of `<Card>`s, with the primary action first or sticky at the bottom.
- Aim for one primary button (`variant="primary"`) per screen. Destructive actions use `variant="danger"` and always go through `<ConfirmDialog>`.
- Pickers, forms and confirmations use `<Sheet>` (bottom sheet) rather than new routes where possible.
- Touch targets are at least 48 px (`--tap`). Leave space for the bottom nav (the AppShell already pads `main`).

## Components (in `src/ui`)
| Need | Use |
|---|---|
| Section | `Card` (optional `title`) |
| Menu / list of links | `LinkList` + `LinkRow` (icon, label, hint, trailing) |
| Status label | `Badge tone="good\|warn\|bad\|accent"` |
| Big number | `Stat value label` |
| Number input | `NumberStepper` (reps, kcal, %), `MassInput` (anything in lb/kg) |
| RIR | `RirChips` |
| Toggle | `Toggle` |
| Labeled field | `Field label htmlFor hint` + `<input className={kitStyles.input}>` (import `styles` from `@/ui/kit.module.css`) |
| Chart | `LineChart` (dates + series, optional band) |
| Nothing yet | `EmptyState title action` with the next step as the action |
| Icons | `Icon name` (extend `PATHS` in `Icon.tsx` if needed; keep the 24-px stroke style) |

Use CSS Modules with the tokens in `src/styles/tokens.css`. Don't hard-code colors, and don't add a UI library.

## States
- **Loading:** `useLive` gives `loading` until the first result. Show `<Spinner />` or a skeleton card, never a blank screen.
- **Empty:** explain what goes here and offer the action that fills it, e.g. "No sessions yet. [Start workout]".
- **Errors:** commands already toast `ServiceError` messages. Keep inputs as typed so the user can fix them. Unexpected render errors fall to `RouteError`.
- **Confirm before** voiding or restoring data, restoring a backup, ending a phase, or leaving the logger with unsaved input.

## Numbers and copy
- **Mass:** 1 decimal, trailing zeros trimmed ("220 lb", "37.5 lb", "99.8 kg"). Dumbbell loads say "per hand". Chin-ups show added load: "+50 lb".
- **Regime line:** "4 × 6–10 · RIR 1–2 · rest 2–3 min".
- **Everything else:**
  - kcal with thousands separators ("3,000 kcal")
  - protein/fat/carbs in whole grams
  - rates as "+0.4 lb/wk (+0.25 %/wk)"
  - dates as "Mon 28 Sep" (use `Intl.DateTimeFormat` on the LocalDate at local noon)
- **Copy:** plain, short, second person ("Log your weight"). Say why a suggestion was made in one short line ("Every set hit 10 reps → +10 lb").
- **Tags:** show the Evidence/Heuristic tag on settings only, as a small badge.

## Accessibility
- Every input has a label (visible, or `srOnly` via the component's `label` prop).
- Toggle-like buttons use `aria-pressed`, and live status text uses `role="status"`.
- Don't rely on color alone: badges carry text.
- Respect `prefers-reduced-motion`.
