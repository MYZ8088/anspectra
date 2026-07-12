# @aloom/agent

The Aloom collector executes official Web detection tasks on a user's macOS or
Windows computer.

## Runtime contract

- One persistent Camoufox profile per provider.
- One task-owned page and one fresh conversation per baseline prompt.
- Headless collection by default.
- The same blocked page is promoted to a visible window for human verification.
- Provider concurrency is one; completed checkpoints are never repeated.
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
```

`inspect:modes` is a development-only, headful inspection tool. It does not
send prompts.

## Environment

- `COLLECTOR_API_URL`: optional HTTPS control-plane origin.
- `COLLECTOR_DEVICE_TOKEN`: workspace-scoped pairing token.
- `DEBUG_ENABLED`: verbose local logs.
- `CAMOUFOX_PYTHON_BIN`, `CAMOUFOX_PIP_SPEC`, and
  `CAMOUFOX_BROWSER_CHANNEL`: pinned runtime overrides.

Proxy rotation and auth-session upload are intentionally unsupported. The
collector uses the user's current network and never transmits browser state.
