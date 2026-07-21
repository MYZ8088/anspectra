# @anspectra/errors

Centralized error primitives and error-handling helpers.

## Responsibilities

- Provide typed operational error classes for shared use.
- Provide error normalization and classification helpers.
- Standardize error metadata (`code`, `meta`, `isOperational`) across apps.

## Error Classes

In `src/error/*`:

- `BaseError`
- `ValidationError`
- `AuthError`
- `NotFoundError`
- `EnvError`
- `ExternalServiceError`
- `RateLimitError`
- `DatabaseError`
- `IPRefreshNeededError`

## Utility Helpers

- `toErrorMessage(err)`
- `classifyError(err)`

## Scripts

| Command | Description |
| --- | --- |
| `pnpm --filter @anspectra/errors build` | Compile TypeScript |
| `pnpm --filter @anspectra/errors typecheck` | TypeScript checks |

## Usage

```ts
import { ValidationError, toErrorMessage } from "@anspectra/errors";
```

Use typed errors for predictable API/worker behavior and cleaner telemetry.
