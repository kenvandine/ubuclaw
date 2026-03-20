# UbuClaw

**UbuClaw** is the Ubuntu snap of [OpenClaw](https://openclaw.ai/) — a local-first,
open-source personal AI assistant. It runs entirely on your machine, connects to
your chosen LLM, and performs agentic tasks through chat interfaces like Discord,
Telegram, Slack, or its built-in web UI.

This snap packages OpenClaw with strict confinement so the agent can do its job
without having unsupervised access to your system.

---

## Features

- **Local-first** — no proprietary cloud relay; your data stays on your machine
- **Auto-configured** — detects [Lemonade](https://snapcraft.io/lemonade-server)
  and [Ollama](https://ollama.com/) on first start and configures them as providers
  automatically
- **Any LLM** — works with OpenAI, Anthropic, Ollama, Lemonade, and anything with
  an OpenAI-compatible API
- **Multi-channel** — Discord, Telegram, Slack, web UI, CLI, and more
- **Agentic tools** — web browsing (headless Chromium), file operations, code
  execution, scheduled jobs, MCP server support
- **Strictly confined** — AppArmor + seccomp enforce the minimum set of
  permissions needed; your dotfiles and system are off-limits

---

## Installation

```bash
sudo snap install ubuclaw
```

### Connect interfaces

The `network` and `home` interfaces are connected automatically on install.
`network-bind` (for the local gateway) and `browser-support` (for headless
Chromium) require manual confirmation on first use, or you can pre-connect them:

```bash
sudo snap connect ubuclaw:network-bind
sudo snap connect ubuclaw:browser-support
```

---

## Quick start

### Automatic setup with Lemonade or Ollama (recommended)

If you have [Lemonade](https://snapcraft.io/lemonade-server) or
[Ollama](https://ollama.com/) running locally, UbuClaw configures itself
automatically on first service start — no onboarding wizard required:

```bash
snap start --enable ubuclaw.service
```

On first boot, UbuClaw probes `http://localhost:8000/api/v1/models` (Lemonade)
and `http://localhost:11434/v1/models` (Ollama), registers every discovered
model as a provider, and picks the best text-capable model as the primary
(preferring FLM and GGUF models; image, audio, and embedding models are
deprioritised). Open `http://127.0.0.1:18789` in your browser to start chatting.

If both services are running, Lemonade is used as the primary provider and
Ollama as the fallback.

> **Note:** Cloud providers (OpenAI, Anthropic, etc.) are disabled by default.
> Only locally configured providers are active. Run `ubuclaw onboard` to add
> a cloud provider if desired.

### Manual setup (any LLM provider)

Run the interactive onboarding wizard to configure your LLM provider and API
key, then start the service:

```bash
ubuclaw onboard
snap start --enable ubuclaw.service
```

### Service management

`ubuclaw.service` runs as a **systemd user unit** (`daemon-scope: user`), so no
`sudo` is needed — it starts under your own account and shares the same config
directory as the `ubuclaw` CLI.

```bash
snap start  --enable  ubuclaw.service   # start now and on every boot
snap stop   --disable ubuclaw.service   # stop and disable autostart
snap restart          ubuclaw.service   # restart after config changes
snap logs             ubuclaw.service   # tail the gateway log
```

The gateway listens on `ws://127.0.0.1:18789`. Open `http://127.0.0.1:18789`
in your browser to access the web UI, or connect a chat channel through the
onboarding wizard.

---

## Data storage

All user data is stored in `~/snap/ubuclaw/common/` — a non-versioned directory
that persists across snap refreshes.

| Path | Contents |
|------|----------|
| `~/snap/ubuclaw/common/` | Root of all snap-private user data |
| `~/snap/ubuclaw/common/.openclaw/openclaw.json` | OpenClaw config (shared by CLI and service) |
| `~/snap/ubuclaw/common/workspace/` | Default agent working directory |
| `~/snap/ubuclaw/common/.cache/` | Transient cache (safe to delete) |

Because `ubuclaw.service` runs as a **user-scoped daemon**, both the service and
the `ubuclaw` CLI app resolve `$SNAP_USER_COMMON` to the same path. Config writes
from `ubuclaw config` are immediately visible to the running service without any
root/user path mismatch. Data is private to your account and backed up by
`snap save`.

> **Tip:** To give the agent access to a project directory, either keep it in a
> non-hidden folder under `$HOME` (e.g. `~/projects/`) or symlink it there.
> The snap's `home` interface covers all non-hidden directories in your home.

---

## Snap interfaces

| Interface | Auto-connected | Purpose |
|-----------|---------------|---------|
| `home` | yes | Agent read/write access to non-hidden directories in `$HOME` (e.g. `~/Documents`, `~/projects`) |
| `network` | yes | Outbound connections to LLM APIs, chat-service webhooks, and the web |
| `network-bind` | no | Bind the local HTTP + WebSocket gateway on `127.0.0.1:18789` |
| `browser-support` | no | Run the bundled headless Chromium with its own kernel-namespace sandbox |

### Why `home` and not full filesystem access?

OpenClaw needs to read and write user files as part of its agentic tasks. The
`home` interface limits that to non-hidden directories inside `$HOME`, keeping
system files and hidden config directories (e.g. `~/.ssh`, `~/.gnupg`) out of
reach. OpenClaw's own config and memory are stored in
`~/snap/ubuclaw/common/`, which is separate from your regular home files.

### Why `browser-support`?

OpenClaw uses `playwright-core` to drive a headless Chromium for web-browsing
tasks. Chromium requires either a SUID helper binary or kernel user namespaces
to run its internal process sandbox. The `browser-support` plug with
`allow-sandbox: true` grants access to unprivileged user namespaces so Chromium
can sandbox itself without needing a SUID binary — the more secure of the two
options.

Chromium is **bundled inside the snap** at build time via `playwright install
chromium`, so it is pinned to a known version and never downloaded at runtime.

---

## Known limitations

### Small model security warning

When using models with fewer than 300B parameters (which includes all local
models), OpenClaw emits a CRITICAL warning recommending Docker-based sandboxing
for code execution. This is a false positive in the snap context: the snap's
AppArmor strict confinement and seccomp filtering already provide system-level
isolation that OpenClaw is unaware of. The warning is cosmetic and does not
affect functionality.

### Skill background services

OpenClaw skills that manage their own long-running background services use
`systemctl --user` under the hood. The snap includes a `systemctl` shim that
translates those calls into D-Bus messages to `org.freedesktop.systemd1`, but
strict confinement does not currently grant the AppArmor rules needed to make
those D-Bus calls. Skills that depend on user-managed systemd services will
report `systemctl not available`; all other skill functionality works normally.

---

## Building from source

Requires [Snapcraft](https://snapcraft.io/docs/snapcraft-overview) and either
LXD or Multipass for the build environment.

```bash
git clone https://github.com/kenvandine/ubuclaw.git
cd ubuclaw
snapcraft
```

Install the locally built snap:

```bash
sudo snap install ubuclaw_*.snap --dangerous
```

### Version tracking

The snap version is derived automatically from the `openclaw` npm package
version at build time via `craftctl set version`. No manual version bump is
needed when OpenClaw releases a new version; just rebuild.

---

## Updating

```bash
sudo snap refresh ubuclaw
```

The snap tracks the `stable` channel and will update automatically when a new
build is published.

---

## Removing

```bash
sudo snap remove ubuclaw
```

To also delete your config and conversation history:

```bash
sudo snap remove --purge ubuclaw
```

---

## Troubleshooting

### The agent can't browse the web

Make sure the `browser-support` interface is connected:

```bash
snap connections ubuclaw
sudo snap connect ubuclaw:browser-support
```

If Chromium still fails to launch, check the snap log:

```bash
snap logs ubuclaw.service -n 50
```

### The gateway won't bind to port 18789

Connect `network-bind`:

```bash
sudo snap connect ubuclaw:network-bind
```

### I can't reach files in my home directory

Only **non-hidden** directories are accessible via the `home` interface. Move
or symlink the directory to a non-hidden path (without a leading `.`) under
`$HOME`.

### Lemonade/Ollama was not detected on first start

Provider auto-detection only runs once (when no config file exists). To
re-run it, remove the config file and restart the service:

```bash
snap stop ubuclaw.service
rm ~/snap/ubuclaw/common/.openclaw/openclaw.json
snap start ubuclaw.service
```

### Config got corrupted / I want a clean slate

Stop the service, remove the data directory, then restart:

```bash
snap stop ubuclaw.service
rm -rf ~/snap/ubuclaw/common
snap start ubuclaw.service
```

The service will re-run provider detection and first-boot setup automatically.

---

## Contributing

Issues and pull requests are welcome at
<https://github.com/kenvandine/ubuclaw>. For bugs in OpenClaw itself, please
report upstream at <https://github.com/openclaw/openclaw>.

---

## License

The snap packaging in this repository is released under the
[GPL-3 License](LICENSE). OpenClaw itself is licensed under its own terms — see
the [upstream repository](https://github.com/openclaw/openclaw) for details.
