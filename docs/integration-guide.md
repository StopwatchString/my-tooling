# Layering integration guide

How to build a **downstream layer**: a repo that adds its own dotfiles on top
of my-tooling (the **base layer**) without editing it. Written for coding
agents. Everything here is the contract; you shouldn't need to read the base
repo's files to build a layer, only this guide.

## The model

A **layer** is a directory laid out by the conventions below. Every part is
optional. `setup.sh` builds each config from a **stack** of layers, lowest
precedence first:

```
base (my-tooling)  →  downstream layers, in order  →  host layer  →  host's own files
                                                                    (win most)
```

- **Base**: this repo.
- **Downstream**: your repo, and maybe more stacked on it (a team layer, then a
  personal one on top).
- **Host layer**: `~/.config/dotfiles/host/` (or `$DOTFILES_HOST_LAYER`), an
  untracked directory with the same layout, for one machine. Used if it
  exists.
- **Host's own files**: shell rc files, `~/.ssh/config`, `~/.tmux.conf`,
  `~/.config/nvim/init.lua` and some others stay real files the host owns.
  setup keeps only a marked block inside them, and the host's lines outside
  the block win.

Every target gathers its path from **every** layer. So a layer only adds files
in conventional places. It never edits, lists or even knows about the files
of the layers below it.

Running a repo's `setup.sh` builds the stack *that repo* defines:

- Base's `setup.sh` alone builds base + host layer, as if base were the last
  repo.
- Your `setup.sh` builds base + you + host layer.
- Each run removes whatever the previous run built that the current stack no
  longer produces (recorded in `~/.config/dotfiles/build/managed`).

So switching which `setup.sh` you run cleanly switches the stack.

## Quick start

```
work-dotfiles/
  setup.sh                 required: entry point (template below)
  layer.sh                 optional: targets of your own (see "Your own targets")
  shell/common/aliases.sh  optional: any conventional path from the table below
  ai/skills/my-skill/SKILL.md
  ...
```

`setup.sh`: copy this verbatim, then adjust only the parent's location:

```bash
#!/usr/bin/env bash
# setup.sh — build the dotfiles with this repo layered on top of my-tooling.
# All arguments pass through (-n, -s, -u, -h, --skip, and --layer from repos
# stacked on this one).
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
parent="${MY_TOOLING:-$HOME/my-tooling}"   # or "$here/my-tooling" for a submodule
if [[ ! -x $parent/setup.sh ]]; then
  echo "error: my-tooling not found at $parent (set MY_TOOLING)" >&2
  exit 1
fi
exec "$parent/setup.sh" --layer "$here" "$@"
```

Rules for `setup.sh`:

- **Pass `"$@"` after your own `--layer`.** That's how stacking works: a layer
  on top of yours execs *your* `setup.sh` with `--layer <itself>`, and you
  forward it. The base then sees `--layer you --layer them` in the right
  order.
- `exec` the parent last. To run things before it (a check, a `git
  submodule update`), do that above the `exec`. For things that should show
  up in `-s`/`-n`, use `step` in `layer.sh` instead.
- Find the parent with an env var plus a default, or vendor it as a git
  submodule. Don't hard-code a machine-specific absolute path.
- Fixed `--skip` patterns go before `"$@"`, e.g.
  `exec "$parent/setup.sh" --layer "$here" --skip 'step: GNOME*' "$@"`.

Then run `./setup.sh -n` (dry run), `./setup.sh`, and `./setup.sh -s` (status).

## Conventions: where to put files

Paths are relative to the layer root. "Later wins" means a higher layer (or
the host) overrides a lower one.

| Layer path | Ends up in | How layers combine |
|---|---|---|
| `shell/common/env.sh` | bash + zsh (interactive) | sourced per layer, see [Shells](#shells) |
| `shell/common/aliases.sh` | bash + zsh | sourced per layer |
| `shell/common/functions.sh` | bash + zsh | sourced per layer |
| `shell/os/linux.sh`, `shell/os/macos.sh` | bash + zsh, that OS only | sourced per layer |
| `shell/bash/rc.bash` | bash only, last stage | sourced per layer |
| `shell/zsh/early.zsh` | zsh only, first stage | sourced per layer |
| `shell/zsh/rc.zsh` | zsh only, last stage | sourced per layer |
| `shell/zsh/env.zsh` | every zsh, incl. scripts (`~/.zshenv`) | sourced per layer |
| `tmux/tmux.conf` | `~/.tmux.conf` | each `source-file`d in order; later wins |
| `ssh/config` | `~/.ssh/config` | each `Include`d, **highest layer first** (ssh keeps the first value) |
| `nvim/` (`init.lua`, `lua/`, `lsp/`, `after/`, ...) | `~/.config/nvim/init.lua` | every layer's dir on the runtimepath, each `init.lua` run in order |
| `ghostty/config` | `~/.config/ghostty/config` | contents copied in order; later values win |
| `vscode/settings.json` | VS Code `User/settings.json` | deep-merged JSON (comments OK) |
| `vscode/keybindings.json` | VS Code `User/keybindings.json` | arrays appended |
| `lang/clang/.clang-format` | `~/.clang-format` | **highest layer's file only** (symlink) |
| `lang/clangd/config.yaml` | clangd user config | one YAML document per layer, applied in order |
| `agents/AGENTS.md` | `~/.claude/CLAUDE.md`, `~/.pi/agent/AGENTS.md` | contents concatenated in order |
| `claude/settings.json` | `~/.claude/settings.json` | deep-merged JSON |
| `ai/skills/<name>/` | `~/.agents/skills/<name>`, `~/.claude/skills/<name>` | one link per item; same name → later wins + `WARN` |
| `pi/extensions/<item>` | `~/.pi/agent/extensions/<item>` | one link per item; same name → later wins + `WARN` |
| `pi/agents/<item>`, `pi/skills/<item>`, `pi/prompts/<item>`, `pi/themes/<item>` | `~/.pi/agent/<dir>/<item>` | one link per item |
| `pi/APPEND_SYSTEM.md` | `~/.pi/agent/APPEND_SYSTEM.md` | contents concatenated in order |
| `pi/settings.json`, `pi/mcp.json`, `pi/keybindings.json` | `~/.pi/agent/…` | deep-merged JSON |

VS Code paths are under `~/.config/Code/User` on Linux and
`~/Library/Application Support/Code/User` on macOS. clangd's are
`~/.config/clangd/config.yaml` and `~/Library/Preferences/clangd/config.yaml`.
The base handles both OSes. Put a file at the conventional path and it goes
to the right place.

Items in collection directories (skills, pi dirs) are matched by name. Files
starting with `.` (e.g. `.gitkeep`) are ignored.

### What each mechanism means for you

- **Sourced / included / runtimepath** (shells, tmux, ssh, nvim): live. Edits
  to your files take effect in the next shell or editor without re-running
  setup. Adding a *new* file at a conventional path needs no setup run
  either, except for collection items, which need a link (run setup).
- **Copied** (`agents/AGENTS.md`, `ghostty/config`, `pi/APPEND_SYSTEM.md`,
  clangd): re-run `./setup.sh` after editing. `-s` shows `DIFF` until then.
- **Merged JSON**: objects merge recursively, later layer wins per key. An
  array *inside* an object is replaced whole. A top-level array (VS Code
  keybindings) gets entries appended. A `null` value deletes the key, so a
  higher layer can drop a key a lower layer sets. The merge goes over the
  live file, so keys the app or the user set and no layer mentions survive.
  Keys a layer
  sets are reset on every run (with a backup). Keys a layer stops setting are
  removed, unless someone changed their value since. JSONC (`//`, `/* */`,
  trailing commas) is accepted in layer files.
- **Highest file wins** (`.clang-format`): your file replaces the base's
  entirely, with a `WARN`. Copy the base's content first if you want to
  extend it.
- **Collections**: you can add items, or replace one by using the same name
  (with a `WARN`). To remove a lower layer's item, list its name in a
  `.remove-<item>` file in your own collection directory (one name per line,
  `#` comments allowed); it only applies to items from lower layers.

## Shells

The host's `~/.bashrc`, `~/.zshrc`, `~/.zshenv` and `~/.bash_profile` get a
managed block at the top. It sources a loader generated into
`~/.config/dotfiles/build/`. The loader sets these variables, all exported
except `DOTFILES_LAYER`:

- `DOTFILES`: the base repo
- `DOTFILES_LAYERS`: every layer root, `:`-joined, lowest first
- `DOTFILES_OS`: `linux` or `macos`

It also defines `has_cmd`, `is_linux`, `is_macos` and `dotfiles_os`. Then it
runs **each stage for all layers before moving to the next stage**:

```
bash:  os/<os>.sh → common/env.sh → common/aliases.sh → common/functions.sh → [legacy local.sh] → bash/rc.bash
zsh:   zsh/early.zsh → os/<os>.sh → common/env.sh → common/aliases.sh → common/functions.sh → [legacy local.sh] → zsh/rc.zsh
zshenv: zsh/env.zsh
```

Within a stage the order is base, then your layer, then layers above you, then
the host layer. The host's own lines after the block come last.

Rules for shell files:

- `shell/common/*` and `shell/os/*` must parse in **both bash and zsh**. Put
  shell-specific code in the `bash/`/`zsh/` stages.
- Only interactive shells load them (`env.zsh` runs for every zsh, so keep it
  to PATH-level work).
- `$DOTFILES_LAYER` is your layer's root **while your file is being
  sourced**, and unset afterwards. If a function or alias needs it at run
  time, copy it at source time:
  `WORK_DOTFILES="$DOTFILES_LAYER"` (exported if scripts need it), then use
  `$WORK_DOTFILES` in the function. Don't use `$DOTFILES` for your own files;
  it's the base.
- The base's `zsh/early.zsh` turns on Powerlevel10k's instant prompt. After
  that, **nothing may print or read input** during zsh startup. Anything that
  does must go in your `zsh/early.zsh`. Base's runs before yours, so
  unavoidable output also goes there, and is still after instant prompt;
  avoid it.
- Guard tool-specific aliases with `has_cmd foo`.
- Overriding is just redefining: your `alias ll=...` in
  `common/aliases.sh` runs after base's.

## nvim

Every layer's `nvim/` goes on the runtimepath right after
`~/.config/nvim`, highest layer first, with their `after/` dirs before the
host's `after/`. Then each layer's `nvim/init.lua` runs, lowest first, and
the host's own `~/.config/nvim/init.lua` lines run after that.

- **Namespace your Lua modules**: `nvim/lua/<yourlayer>/foo.lua`, used as
  `require('<yourlayer>.foo')`. A file with the same path as a lower layer's
  (e.g. `lua/utils.lua`) *hides* it and breaks that layer's `require`. Setup
  warns `nvim/lua/...: <you> shadows <base>`. Treat that warning as an error.
- Your `init.lua` runs inside `pcall`. A failure is reported and doesn't stop
  the other layers.
- Plugins: call `vim.pack.add{...}` in your own `init.lua`.

## Your own targets: `layer.sh`

For a config the base doesn't cover, add `layer.sh` at your layer root.
`setup.sh` sources every layer's `layer.sh` in stack order (base first). In it
you declare targets with the functions below. **A target you declare
gathers its path from every layer**, including layers stacked on top of
yours later. So you're also defining a convention that higher layers can
fill in, exactly like base does.

Environment while `layer.sh` runs:

- bash (must work with **bash 3.2** for macOS: no associative arrays,
  `mapfile`, `readlink -f`, `${x,,}`), under **`set -euo pipefail`**.
  `cond && cmd` as a last statement aborts setup when `cond` is false; use
  `if`.
- `$LAYER`: your layer root. `$DOTFILES`: base root. `$CONFIG_HOME`:
  `${XDG_CONFIG_HOME:-~/.config}`. `$BUILD`: `~/.config/dotfiles/build`.
  `LAYERS`: array of all layer roots, lowest first. `is_linux`, `is_macos`
  and `has_cmd` are available.
- Everything runs as it's declared. Prefix your functions and globals with
  your layer's name (`work_…`), because every layer's `layer.sh` shares one
  shell.

### Target functions

Paths named `<path>` are relative to a layer root. `<dest>` is absolute.

| Function | Does |
|---|---|
| `link <path> <dest>` | Symlink `dest` to `<path>` from the highest layer that has it (`WARN` when one overrides another). |
| `link_each <dir> <dest dir>` | Make `dest dir` a real directory and symlink every item of `<dir>`, from every layer, into it by name. Later layer wins on a name clash (`WARN`). A `.remove-<item>` file in a layer's `<dir>` lists item names (one per line) it removes from lower layers. Items in `dest dir` that setup didn't create are left alone. |
| `block <dest> top\|bottom <style> <render…>` | Keep a block, delimited by marker comments, holding the output of the render command in a host-owned file. `style`: `hash` (`#`), `lua` (`--`) or `html` (`<!-- -->`). Use `top` when later lines override earlier ones, and `bottom` when the first value wins. The file is created if missing. A non-empty file is backed up before the block is first added. |
| `generate <dest> <render…>` | Write the output of the render command, under a `# dotfiles: generated…` header, as the whole file. For formats without includes or "later wins" ordering. Needs `#` comments. Host overrides go in the host layer. |
| `json <path> <dest> [jq filter]` | Merge `<path>` from every layer over the live JSON file (see Merged JSON above). A `null` value deletes the key. The filter runs on the result. Needs `jq`. |
| `step <name> <check fn> <apply fn>` | Non-file setup: `apply` runs only if `check` fails (the check's output is hidden). `-s` shows `ok`/`todo`. Uninstall doesn't undo steps. |
| `shadow_check <dir>` | `WARN` for files under `<dir>` that exist in two layers. |

Render commands print content to stdout; built-ins:

| Renderer | Prints |
|---|---|
| `render_concat <path> <label fmt> [separator]` | Each layer's `<path>` in order, each preceded by `printf <label fmt> <file>` (e.g. `'# --- %s'`), with an optional separator line between them (e.g. `---`). |
| `render_each <fmt> <path> [reverse]` | One line per layer, `printf <fmt> <layer>/<path>`, **whether or not the file exists**, which suits includes that ignore missing files. `reverse` puts the highest layer first. |
| `render_lines <line>…` | The given lines. |

Or write your own function that iterates `"${LAYERS[@]}"`.

Pick the mechanism in this order:

1. The tool has an include or source directive and "later wins" → `block`
   with `render_each`, in the host's file. It stays live and the host's lines
   win.
2. A directory of named items → `link_each`.
3. JSON the app also writes → `json`.
4. A single file where later values win → `block` with `render_concat`.
5. Otherwise `generate`, or `link` if a whole-file replacement is right.

Example `layer.sh`:

```bash
# layer.sh — targets added by work-dotfiles (sourced by my-tooling's setup).

# git: every layer's git/config included from the host's ~/.gitconfig;
# git applies includes in order and later values win.
block "$HOME/.gitconfig" top hash render_each '[include] path = "%s"' git/config

# Work CLI plugins, one link per plugin; higher layers can add or replace.
link_each workcli/plugins "$HOME/.workcli/plugins"

# A tool installed once per machine.
work_vpn_ok()      { has_cmd workvpn; }
work_vpn_install() { "$LAYER/scripts/install-vpn.sh"; }
step "work VPN client" work_vpn_ok work_vpn_install
```

That `step` calls `$LAYER` directly, which is fine because steps run while
`layer.sh` is being sourced. Function bodies that run later need their own
copy of the path.

Declaring the same target twice with the same arguments is fine; it runs
once. That lets two independent layers both add, say, git support. Declaring
the same `<dest>` with *different* arguments is a `CONFLICT` problem: you
can't redirect or redefine a base target. If you really need to replace
one, skip the lower layer's target with a layer-scoped `--skip` pattern
(`--skip '<lower layer's name>:<dest pattern>`) and declare your own target
at the same dest.

## Flags

All pass through your `setup.sh`:

- (none): build. `-n`: dry run. `-s`: status. `-u`: uninstall everything
  managed (links, generated files, blocks, the JSON keys setup set; the
  host's own content stays). `-h`: help.
- `--skip PATTERN`: leave out targets whose destination, or step name (also
  matchable as `step: <name>`), matches the shell pattern. E.g.
  `--skip "$HOME/.config/ghostty/*"`, `--skip 'step: *'`. A skipped target
  isn't declared, so anything an earlier run built for it is removed as
  stale. A plain pattern matches targets from every layer at that dest, so it
  can't be used to replace a target. `<layer name>:PATTERN` (name = directory
  name, `host` for the host layer) matches only that layer's targets: use it
  when a higher layer declares its own target at the same dest and wants to
  replace the lower one's.

Status labels: `ok`, `absent` (not built yet), `DIFF` (out of date), `FILE`
(a real file is in the way; backed up on setup), `OTHER` (a symlink
elsewhere; replaced), `LEGACY` (an old symlink into a layer; replaced),
`stale` (built by an earlier run, not by this stack; removed on setup),
`todo` (a step to run), `WARN` (a later layer overrides an earlier one),
`skip`.

Exit status is non-zero when there were problems (`MISSING`, `BAD`,
`CONFLICT`, `FAILED`, `NO-JQ`). Warnings don't fail the run.

## Checklist for a new layer

1. Create `setup.sh` from the template and make it executable. Add
   `layer.sh` only if you need targets of your own.
2. Put files at conventional paths. Namespace nvim Lua under
   `lua/<layer>/`. Prefix shell globals/functions you introduce.
3. Shared shell files must pass both `bash -n` and `zsh -n`.
4. Test in a sandbox home, never the real one first:

   ```bash
   sb=$(mktemp -d)
   HOME=$sb GSETTINGS_BACKEND=memory ./setup.sh --skip 'step: *'
   HOME=$sb ./setup.sh -s --skip 'step: *'      # expect only ok (+ intended WARNs)
   HOME=$sb bash -ic 'type <your alias>'        # shells start, your bits load
   HOME=$sb zsh -ic 'type <your alias>'
   ```

   Then run the base's `setup.sh` against the same sandbox and confirm your
   items are removed. Then your `setup.sh` again.
5. Review every `WARN`. Each is a place where you replace something from a
   lower layer. Keep it only if that's intended.

## Gotchas

- ssh: put host-specific `Host` blocks in your `ssh/config`. They override
  lower layers because your file is included first. Lines the *host* adds go
  **above** the block in `~/.ssh/config`.
- tmux: `unbind -a` or similar in a lower layer runs before yours, so you can
  rebind freely.
- `~/.bash_profile` gets a block that sources `~/.bashrc`. A login bash then
  skips `~/.profile` (as before layering).
- Files the base copies (AGENTS.md, ghostty, APPEND_SYSTEM.md) need a setup
  run after edits. Linked, included and sourced ones don't.
- Don't write into `~/.config/dotfiles/build/` or inside a managed block.
  Both are regenerated.
- The base was migrated from whole-file symlinks. Old links into any layer
  are replaced automatically (`LEGACY`), so a layer that previously
  symlinked its own files can move to this scheme without manual cleanup.
