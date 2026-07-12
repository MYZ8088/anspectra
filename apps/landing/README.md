# @aloom/landing

Public marketing site for Aloom, deployed separately on Vercel.

## Responsibilities

- Present product narrative, capabilities, and OSS messaging.
- Showcase static previews powered by shared UI/types utilities.
- Route users to the application and docs.

## Structure

- `src/app/page.tsx`: assembles landing sections.
- `src/components/sections/*`: major page sections.
- `src/components/previews/*`: visual product previews.
- `src/lib/landing-content.ts`: section copy/content model.
- `src/lib/preview-data.ts`: preview dataset used across components.

## Scripts

| Command | Description |
| --- | --- |
| `pnpm --filter @aloom/landing dev` | Start Next.js dev server |
| `pnpm --filter @aloom/landing build` | Build production bundle |
| `pnpm --filter @aloom/landing start` | Start built app |
| `pnpm --filter @aloom/landing typecheck` | TypeScript checks |
| `pnpm --filter @aloom/landing lint` | Biome lint/check |

## Environment Variables

- No required runtime environment variables are currently defined for this app.
- `.env.example` is intentionally minimal.

## Local Development

```bash
pnpm --filter @aloom/landing dev
```

If port `3000` is already used by another app, run with a custom `PORT`.

## Dependencies

- `@aloom/ui`
- `@aloom/types`
- `@aloom/utils`

These ensure landing previews stay aligned with product domain and shared components.
