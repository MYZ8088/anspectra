# @anspectra/ui

Shared React component library for Anspectra apps.

## Responsibilities

- Provide reusable UI primitives and composed dashboard components.
- Keep product and marketing interfaces visually consistent.
- Centralize component contracts used by `apps/web` and `apps/landing`.

## Component Areas

- Primitives: `button`, `input`, `dialog`, `table`, `tabs`, `tooltip`, etc.
- Dashboard suite: competitor tables/charts, stats rows, source panels, response previews.
- Shared hooks: `use-mobile`, `use-sort-state`.
- Shared styles: `src/styles/shared.css`.

## Exports

Main barrel: `src/index.ts`.

Notable export path:
- `@anspectra/ui/styles/shared.css`

## Scripts

| Command | Description |
| --- | --- |
| `pnpm --filter @anspectra/ui build` | Compile TypeScript |
| `pnpm --filter @anspectra/ui typecheck` | TypeScript checks |

## Dependencies and Peers

- Runtime deps include Radix UI primitives, `lucide-react`, and form helpers.
- Peer deps:
  - `react`
  - `react-dom`

## Usage

```tsx
import { Button, Table, BrandComparisonChart } from "@anspectra/ui";
import "@anspectra/ui/styles/shared.css";
```

## Contribution Guidance

- Keep components presentation-focused; business logic belongs in `apps/web` or `@anspectra/services`.
- Prefer expanding existing primitives over adding one-off variants.
- Export new components through `src/index.ts` to keep imports consistent.
