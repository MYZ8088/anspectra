# @aloom/agent

The Aloom collector executes official Web detection tasks on a user's macOS or
Windows computer.

## Runtime contract

- One persistent Camoufox profile per provider.
- One task-owned page and one fresh conversation per baseline prompt.
- Headless collection by default.
- The same blocked page is promoted to a visible window for human verification.
- Concurrency is one inside each provider. Selected providers run in parallel
  through a resource-aware global gate; completed checkpoints are never repeated.
- Structured analysis runs in a separate bounded background gate and cannot
  hold a provider browser slot.
- Cookies, local storage, and profiles remain under `.aloom-storage/`.
- A paired collector communicates with the control plane only through outbound
  HTTPS requests authenticated with a workspace-scoped device token.

Formal providers are Doubao, DeepSeek, Yuanbao, and Qwen. Legacy adapters may
remain for historical compatibility but are not exposed by the detection
product.

## Commands

```bash
pnpm camoufox:setup
pnpm camoufox:doctor
pnpm collector
pnpm --filter @aloom/agent inspect:modes qwen 180 --watch
pnpm --filter @aloom/agent inspect:modes qwen 10 --headless --apply=web_search
```

`inspect:modes` is a development-only, headful inspection tool. It does not
send prompts. Add `--headless` to verify the production launch path without
opening a visible window. Add `--apply=<mode>` to apply and verify a provider
mode without submitting a prompt.

## Environment

- `COLLECTOR_API_URL`: optional HTTPS control-plane origin.
- `COLLECTOR_DEVICE_TOKEN`: workspace-scoped pairing token.
- `COLLECTOR_PROVIDER_CONCURRENCY`: maximum providers collected in parallel;
  defaults to `4` and automatically falls to `2` below four logical CPUs or
  12 GiB of memory.
- `COLLECTOR_ANALYSIS_CONCURRENCY`: maximum concurrent background analysis
  calls; defaults to `2`.
- `DEBUG_ENABLED`: verbose local logs.
- `CAMOUFOX_PYTHON_BIN`, `CAMOUFOX_PIP_SPEC`, and
  `CAMOUFOX_BROWSER_CHANNEL`: pinned runtime overrides.

Proxy rotation and auth-session upload are intentionally unsupported. The
collector uses the user's current network and never transmits browser state.
