# Exercise Applet

[![CI & Deploy](https://github.com/throbbingmember69/Exersise-Applet/actions/workflows/ci-deploy.yml/badge.svg)](https://github.com/throbbingmember69/Exersise-Applet/actions/workflows/ci-deploy.yml)

An offline-first phone app (PWA) for training and bulk/cut tracking:

- **Workout logger:** pre-filled loads from double progression, per-set load/reps/RIR, and a rest timer
- **Progression engine:** e1RM trends, stall flags and deload suggestions
- **Volume dashboard:** weekly fractional sets per muscle against evidence-based bands
- **Body log:** daily weigh-ins smoothed into a trend weight
- **Nutrition:** phase targets (lean bulk / maintenance / cut), daily intake, and weekly check-ins using measured maintenance
- **Program editor and gym profiles:** swap exercises per gym without losing history
- **Export:** CSV files and full JSON backup/restore

All data stays on your device (IndexedDB). The rules and their evidence are in [`Training & Bulk Cut Plan Findings and Applet Spec.md`](./Training%20%26%20Bulk%20Cut%20Plan%20Findings%20and%20Applet%20Spec.md), and design decisions in [`docs/`](./docs).

**Live app:** https://throbbingmember69.github.io/Exersise-Applet/

## Development

Requires Node 24+.

```bash
npm ci
npm run dev      # local dev server
npm run check    # lint + typecheck + tests
npm run build    # production build into dist/
```

Pushes to `main` run CI and deploy to GitHub Pages.

*Not medical advice. Swap or stop any exercise that causes pain.*
