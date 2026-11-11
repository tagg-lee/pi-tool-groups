# Pi Tool Groups

A compact three-level tool-call UI for [Pi](https://github.com/earendil-works/pi): collapse all tool calls from one user request into a single badge, expand the badge to inspect one-line summaries, and expand individual tools only when you need their full output.

```text
│ ▸ [ 4 TOOL CALLS ]  (Ctrl+O to expand)
```

Expanded group:

```text
│ ▾ [ 4 TOOL CALLS ]

  bash  python3 -c "print('hello')"
  bash  herdr --version
  read  src/index.ts
  edit  src/config.ts
```

Each tool row keeps Pi's normal per-tool expansion behavior, so full output stays out of the way until explicitly requested.

## Why

Long tool outputs can dominate a coding conversation. Pi Tool Groups keeps user prompts and assistant responses visually prominent while preserving access to every tool call and result.

## Features

- Groups every tool call from one agent run under one compact header
- Starts collapsed by default
- `Ctrl+O` toggles the one-line tool list
- Clicking the group header toggles the list
- Individual tool rows can still reveal their full output
- Handles sequential and parallel tool calls
- Reconstructs groups when a session is loaded
- Uses Pi's active theme accent color
- Correct singular/plural labels: `1 TOOL CALL` / `N TOOL CALLS`

## Compatibility

Last tested with:

- `@earendil-works/pi-coding-agent` **1.5.2**
- Node.js installations of Pi
- macOS and Linux are the primary tested platforms

There is no version pin. The installer matches exact code anchors in the Pi bundle; if any anchor is missing (e.g. a Pi release changed that code), it fails with `<label>: expected one match, found 0` and restores the original file. Fix the anchor named by `<label>` in `install.mjs`.

> This is a temporary core patch, not a standard Pi extension. Pi's current extension API does not expose a parent transcript container that can replace and group multiple built-in tool rows.

## Install

Review the source first. Pi and this installer run with your user permissions.

```bash
git clone https://github.com/tagg-lee/pi-tool-groups.git
cd pi-tool-groups
node install.mjs
```

Then fully restart Pi. `/reload` is not enough because this patch modifies the Pi runtime bundle.

## Uninstall

From the cloned repository:

```bash
node uninstall.mjs
```

Then restart Pi.

## Safety

The installer:

1. Locates the active `pi` executable automatically
2. Confirms the package is `@earendil-works/pi-coding-agent`
3. Requires every exact-match code anchor to be present (no version pin)
4. Verifies every expected code location before writing
5. Saves the original bundle under `~/.pi/agent/patch-backups/pi-tool-groups/`
6. Runs `node --check` on the patched bundle
7. Restores the backup automatically if installation fails
8. Detects an existing installation and exits safely

## Interaction model

### Level 1 — quiet default

```text
│ ▸ [ 3 TOOL CALLS ]  (Ctrl+O to expand)
```

### Level 2 — tool summaries

```text
│ ▾ [ 3 TOOL CALLS ]

  bash  npm test
  read  src/index.ts
  edit  src/config.ts
```

### Level 3 — one tool's full output

Click an individual tool row to expand only that tool's complete result.

## Updates

A Pi update or reinstall may replace the patched bundle. After updating Pi:

- Do not force this patch onto an unsupported version.
- Check this repository for a compatible release.
- Prefer the upstream implementation if Pi adopts grouped tool calls natively.

## Relationship to `pi-collapse-tools`

The original prototype was tested alongside `pi-collapse-tools`. This installer patches Pi's group container behavior; per-tool rendering remains governed by Pi and any installed renderer extension. The best long-term implementation is an upstream Pi feature that owns all three display levels directly.

## Upstream plan

The intended long-term home for this behavior is Pi itself. A future upstream proposal should add a setting such as:

```json
{
  "toolDisplay": "grouped"
}
```

and implement the behavior in the TypeScript source with tests for streaming, parallel calls, failures, aborts, and session reconstruction.

## License

MIT © Cool-Tagg
