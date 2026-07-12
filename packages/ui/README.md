# @aloom/ui

Shared React component library for Aloom apps.

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
- `@aloom/ui/styles/shared.css`

## Scripts

| Command | Description |
| --- | --- |
| `pnpm --filter @aloom/ui build` | Compile TypeScript |
| `pnpm --filter @aloom/ui typecheck` | TypeScript checks |

## Dependencies and Peers

- Runtime deps include Radix UI primitives, `lucide-react`, and form helpers.
- Peer deps:
  - `react`
  - `react-dom`

## Usage

```tsx
import { Button, Table, BrandComparisonChart } from "@aloom/ui";
import "@aloom/ui/styles/shared.css";
```

## Contribution Guidance

- Keep components presentation-focused; business logic belongs in `apps/web` or `@aloom/services`.
- Prefer expanding existing primitives over adding one-off variants.
- Export new components through `src/index.ts` to keep imports consistent.
