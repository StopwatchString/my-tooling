# layer.sh — the targets this repo declares, sourced by lib/build.sh with
# $LAYER set to this repo. Every target gathers its path from every layer in
# the stack (this repo, downstream layers, the host layer), so the paths used
# here are the conventions downstream layers fill in. Documented for them in
# docs/integration-guide.md; keep the two in sync.
#
# Runs under `set -euo pipefail` and bash 3.2: use `if`, not `cond && cmd`,
# for anything that can be false as the last command.

if is_macos; then
  VSCODE_USER="$HOME/Library/Application Support/Code/User"
  CLANGD_CONFIG="$HOME/Library/Preferences/clangd/config.yaml"
else
  VSCODE_USER="$CONFIG_HOME/Code/User"
  CLANGD_CONFIG="$CONFIG_HOME/clangd/config.yaml"
fi
PI_DIR="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"
NOTE="Managed by $DOTFILES/setup.sh from the layers; edit those, not this block."

# ---------------------------------------------------------------- shells ---
# The host's ~/.bashrc, ~/.zshrc and ~/.zshenv keep a managed block at the
# top that sources a generated loader; the host's own lines below it win.
# The loader runs each stage below for every layer before the next stage, with
# $DOTFILES_LAYER set to the layer being sourced.

# render_shell rc|env <stage>...: a loader. A stage is a path under shell/;
# `os` means shell/os/$DOTFILES_OS.sh and `local` the legacy, untracked
# ~/.config/shell/local.sh. rc loaders first set $DOTFILES (this repo),
# $DOTFILES_LAYERS (all layers, ':'-joined) and $DOTFILES_OS, and load
# lib/os.sh (has_cmd, is_linux, is_macos).
render_shell() {
  local kind="$1" stage l path
  shift
  if [[ $kind == rc ]]; then
    echo "DOTFILES=$(shq "$DOTFILES")"
    echo "DOTFILES_LAYERS=$(shq "$(layers_joined)")"
    echo "export DOTFILES DOTFILES_LAYERS"
    echo ". $(shq "$DOTFILES/lib/os.sh")"
    echo 'DOTFILES_OS="$(dotfiles_os)"; export DOTFILES_OS'
  fi
  for stage in "$@"; do
    if [[ $stage == local ]]; then
      echo '# legacy per-machine overrides (prefer the host layer or your own rc)'
      echo '[ -f "${XDG_CONFIG_HOME:-$HOME/.config}/shell/local.sh" ] && . "${XDG_CONFIG_HOME:-$HOME/.config}/shell/local.sh"'
      continue
    fi
    echo "# shell/$stage"
    for l in "${LAYERS[@]}"; do
      if [[ $stage == os ]]; then
        path="$(shq "$l/shell/os/")\"\$DOTFILES_OS\".sh"
      else
        path="$(shq "$l/shell/$stage")"
      fi
      echo "DOTFILES_LAYER=$(shq "$l"); [ -f $path ] && . $path"
    done
  done
  echo 'unset DOTFILES_LAYER'
}

generate "$BUILD/bashrc" render_shell rc \
  os common/env.sh common/aliases.sh common/functions.sh local bash/rc.bash
generate "$BUILD/zshrc" render_shell rc \
  zsh/early.zsh os common/env.sh common/aliases.sh common/functions.sh local zsh/rc.zsh
generate "$BUILD/zshenv" render_shell env zsh/env.zsh

block "$HOME/.bashrc" top hash render_lines "# $NOTE" \
  "case \$- in *i*) [ -f $(shq "$BUILD/bashrc") ] && . $(shq "$BUILD/bashrc") ;; esac"
block "$HOME/.zshrc" top hash render_lines "# $NOTE" \
  "[ -f $(shq "$BUILD/zshrc") ] && . $(shq "$BUILD/zshrc")"
block "$HOME/.zshenv" top hash render_lines "# $NOTE" \
  "[ -f $(shq "$BUILD/zshenv") ] && . $(shq "$BUILD/zshenv")"
# Login bash (macOS Terminal, ssh) reads only this; it doesn't source
# ~/.profile on purpose, everything that would set up lives in the layers.
block "$HOME/.bash_profile" top hash render_lines "# $NOTE" \
  '[ -f "$HOME/.bashrc" ] && . "$HOME/.bashrc"'

# ------------------------------------------------------ terminal / editors ---
# tmux: every layer's tmux/tmux.conf, in order; host lines below win.
render_tmux() { render_lines "# $NOTE"; render_each 'source-file -q "%s"' tmux/tmux.conf; }
block "$HOME/.tmux.conf" top hash render_tmux

# nvim: lib/nvim-layers.lua puts every layer's nvim/ on the runtimepath and
# runs its init.lua; the host's ~/.config/nvim/init.lua continues below.
render_nvim() {
  local l list=""
  for l in "${LAYERS[@]}"; do list="$list[==[$l/nvim]==], "; done
  echo "-- $NOTE"
  echo "dofile([==[$DOTFILES/lib/nvim-layers.lua]==])({ ${list%, } })"
}
block "$CONFIG_HOME/nvim/init.lua" top lua render_nvim
shadow_check nvim/lua

# Ghostty loads config-file includes after the including file, so the layers
# are copied into the block instead; the host's lines below still win.
block "$CONFIG_HOME/ghostty/config" top hash render_concat ghostty/config '# --- %s'

json vscode/settings.json    "$VSCODE_USER/settings.json"
json vscode/keybindings.json "$VSCODE_USER/keybindings.json"

# ------------------------------------------------------------------- ssh ---
# ssh takes the FIRST value it finds, so the block goes at the bottom of the
# host's ~/.ssh/config and includes the highest layer first. Host lines go
# above the block.
render_ssh() {
  render_lines "# $NOTE" "# ssh uses the first value it finds: put host lines ABOVE this block." 'Match all'
  render_each 'Include "%s"' ssh/config reverse
}
block "$HOME/.ssh/config" bottom hash render_ssh

# ------------------------------------------------------- language tooling ---
link lang/clang/.clang-format "$HOME/.clang-format"
# clangd applies the fragments of a multi-document file in order.
generate "$CLANGD_CONFIG" render_concat lang/clangd/config.yaml '# --- %s' '---'

# --------------------------------------------------------- coding agents ---
# One instructions file for Claude Code and pi, copied in layer order.
block "$HOME/.claude/CLAUDE.md" top html render_concat agents/AGENTS.md '<!-- from %s -->'
block "$PI_DIR/AGENTS.md"       top html render_concat agents/AGENTS.md '<!-- from %s -->'
json claude/settings.json "$HOME/.claude/settings.json"

# Skills (ai/skills/<name>/SKILL.md), linked one by one for both harnesses.
link_each ai/skills "$HOME/.agents/skills"
link_each ai/skills "$HOME/.claude/skills"

# pi (see pi/README.md). The filter drops the package entry of the retired
# ~/dev/pi-harness repo.
block "$PI_DIR/APPEND_SYSTEM.md" top html render_concat pi/APPEND_SYSTEM.md '<!-- from %s -->'
json pi/keybindings.json "$PI_DIR/keybindings.json"
json pi/mcp.json         "$PI_DIR/mcp.json"
json pi/settings.json    "$PI_DIR/settings.json" \
  'if .packages then .packages |= map(select(tostring | test("pi-harness") | not))
     | if .packages == [] then del(.packages) else . end else . end'
for _d in extensions agents skills prompts themes; do
  link_each "pi/$_d" "$PI_DIR/$_d"
done
unset _d

# -------------------------------------------------------------- not files ---
# A submodule line starting with '-' isn't checked out yet.
base_submodules_ok() {
  local s
  s="$(git -C "$DOTFILES" submodule status)" || return 1
  [[ $s != -* && $s != *$'\n-'* ]]
}
base_submodules_init() { git -C "$DOTFILES" submodule update --init --depth 1; }
base_fonts_ok()        { "$DOTFILES/scripts/install-fonts.sh" --check; }
base_fonts_install()   { "$DOTFILES/scripts/install-fonts.sh"; }
base_nvim_ok()         { "$DOTFILES/scripts/install-nvim.sh" --check; }
base_nvim_install()    { "$DOTFILES/scripts/install-nvim.sh"; }
base_gterm_ok()        { "$DOTFILES/scripts/gnome-terminal-profile.sh" check; }
base_gterm_load()      { "$DOTFILES/scripts/gnome-terminal-profile.sh" load; }

step "zsh plugin submodules" base_submodules_ok base_submodules_init
step "fonts + terminal font" base_fonts_ok      base_fonts_install
step "Neovim nightly"        base_nvim_ok       base_nvim_install
if is_linux; then
  step "GNOME Terminal profile" base_gterm_ok base_gterm_load
fi
