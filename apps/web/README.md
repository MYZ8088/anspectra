# @answerloom/web

Main authenticated product application built with Next.js App Router and tRPC.

## Responsibilities

- Authentication and organization/workspace management.
- Prompt authoring and submission.
- Triggering provider job groups.
- Reading prompt/analysis data from services and rendering dashboard views.
- Scheduling and provider configuration for workspaces.

## App Structure

- `src/app/(auth)/*`: authenticated product pages (dashboard, prompts, schedule, settings, etc.).
- `src/app/login`, `src/app/signup`: auth pages.
- `src/app/api/trpc/[trpc]`: tRPC handler.
- `src/app/api/auth/[...all]`: Better Auth handler.
- `src/server/api/*`: tRPC context, procedures, middleware, routers.
- `src/lib/*`: auth, rate limiting, export and workspace utilities.
- `src/components/*`: app-level components/dialogs/forms.

## API Router Surface

Defined in `src/server/api/root.ts`:

- `workspace`
- `prompt`
- `location`
- `analysis`
- `agent`
- `internal`

## Scripts

| Command | Description |
| --- | --- |
| `pnpm --filter @answerloom/web dev` | Start Next.js dev server |
| `pnpm --filter @answerloom/web build` | Build production bundle |
| `pnpm --filter @answerloom/web start` | Start built app |
| `pnpm --filter @answerloom/web preview` | Build + start |
| `pnpm --filter @answerloom/web typecheck` | TypeScript checks |
| `pnpm --filter @answerloom/web lint` | Biome lint/check |
| `pnpm --filter @answerloom/web check` | Biome check |
| `pnpm --filter @answerloom/web check:write` | Biome write fixes |
| `pnpm --filter @answerloom/web check:unsafe` | Biome unsafe fixes |
| `pnpm --filter @answerloom/web db:generate` | Drizzle generate |
| `pnpm --filter @answerloom/web db:migrate` | Drizzle migrate |
| `pnpm --filter @answerloom/web db:push` | Drizzle push |
| `pnpm --filter @answerloom/web db:studio` | Drizzle studio |

## Environment Variables

Validated in `src/env.js`:

- Server side:
  - `DATABASE_URL`
  - `APP_URL`
  - `INTERNAL_CRON_SECRET`
  - `BETTER_AUTH_SECRET`
  - `GOOGLE_CLIENT_ID`
  - `GOOGLE_CLIENT_SECRET`
  - `NODE_ENV`
- Client side:
  - `NEXT_PUBLIC_API_URL`

Additional runtime values consumed through services/db layers include Redis and ClickHouse variables from root `.env`.

## Local Development

1. Ensure root infra is running (`db`, `clickhouse`, `redis`).
2. Apply migrations:

```bash
pnpm db:migrate
```

3. Start the app:

```bash
pnpm --filter @answerloom/web dev
```

## Dependencies

This app relies on workspace packages:
- `@answerloom/services`: domain/business operations
- `@answerloom/db`: schema and DB clients
- `@answerloom/types`: shared contracts
- `@answerloom/ui`: shared UI components
- `@answerloom/utils`: shared helpers
- `@answerloom/errors`: typed errors

## Development Boundaries

- Keep route handlers/procedures thin; move business logic to `@answerloom/services`.
- Use `authorizedWorkspaceProcedure` for workspace-scoped actions.
- Use `createRateLimiter` middleware for write-heavy mutations.
