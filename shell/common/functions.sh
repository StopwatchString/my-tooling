# Functions shared by bash and zsh.

# Symlink a file into /usr/local/bin.
symlink-binary() {
  if [ $# -ne 1 ]; then
    echo "usage: symlink-binary <file>" >&2
    return 1
  fi
  local src
  src="$(realpath "$1")" || return 1
  if [ ! -f "$src" ]; then
    echo "not a file: $src" >&2
    return 1
  fi
  sudo ln -s "$src" "/usr/local/bin/$(basename "$src")"
}

# Find and (optionally) remove dangling symlinks in /usr/local/bin.
prune-binaries() {
  local dir=/usr/local/bin
  local dead
  dead="$(find "$dir" -maxdepth 1 -type l ! -exec test -e {} \; -print)"
  if [ -z "$dead" ]; then
    echo "no dead symlinks in $dir"
    return 0
  fi
  echo "dead symlinks:"
  echo "$dead"
  printf "remove these? [y/N] "
  read -r reply
  case "$reply" in
    [yY]*) sudo find "$dir" -maxdepth 1 -type l ! -exec test -e {} \; -exec rm -- {} \; -print ;;
    *) echo "aborted" ;;
  esac
}

# pi with the home model server's key pulled from 1Password into the env for
# that run only (pi/extensions/home-models.ts reads $HOME_AI_KEY). Skipped when
# HOME_AI_KEY is already set or `op` isn't installed (socrates itself needs no key).
# Override the item with HOME_AI_KEY_REF in ~/.config/shell/local.sh.
# Over ssh, op's desktop-app integration would wait on an unlock prompt shown
# on this machine's screen (agent forwarding doesn't cover op), so it's turned
# off there and op signs in on the terminal instead (master password; first
# time on a machine it offers to add the account). The session token is
# exported into the calling shell, so later runs there don't ask again.
pi() {
  if [ -z "${HOME_AI_KEY:-}" ] && has_cmd op; then
    local key ref="${HOME_AI_KEY_REF:-op://Personal/home-ai-server/credential}"
    if [ -n "${SSH_CONNECTION:-}" ]; then
      local OP_BIOMETRIC_UNLOCK_ENABLED=false
      export OP_BIOMETRIC_UNLOCK_ENABLED
      if ! op whoami >/dev/null 2>&1; then
        local session
        session="$(op signin)" && eval "$session"
      fi
    fi
    if key="$(op read "$ref" </dev/null 2>/dev/null)"; then
      HOME_AI_KEY="$key" command pi "$@"
      return
    fi
    echo "pi: couldn't read the home-ai-server key from 1Password; home models will fail" >&2
  fi
  command pi "$@"
}

# Switch what the home model server (socrates, ~/serve/ai) has loaded, from any
# machine: runs its `ai` CLI over ssh (locally on socrates itself). Modes:
#   swift    swift on both GPUs (the default, as at boot)
#   mixed    swift on GPU 0, megacapybara-agentic (12 agents) on GPU 1
#   agents   megacapybara-agentic on both GPUs (24 agents)
#   status   what is loaded (also with no mode)
# Override the host with AI_HOST (an ssh alias) in ~/.config/shell/local.sh.
ai-mode() {
  local host="${AI_HOST:-socrates}" cmd
  case "${1:-status}" in
    swift) cmd="start" ;;
    mixed) cmd="use swift@0 megacapybara-agentic@1" ;;
    agents) cmd="use megacapybara-agentic megacapybara-agentic" ;;
    status) cmd="status" ;;
    *)
      echo "usage: ai-mode [swift|mixed|agents|status]" >&2
      return 1
      ;;
  esac
  if [ "$(hostname -s)" = "$host" ]; then
    eval "\"\$HOME/.local/bin/ai\" $cmd"
  else
    ssh "$host" "~/.local/bin/ai $cmd"
  fi
}

# Inside tmux, take SSH_AUTH_SOCK / SSH_CONNECTION from the session, which tmux
# updates from whichever client attached last (local or over ssh). Run before
# every prompt in tmux by bashrc/zshrc, so agent forwarding keeps working
# after reattaching from another machine.
ssh-refresh() {
  [ -n "${TMUX:-}" ] || return 0
  eval "$(tmux show-environment -s SSH_AUTH_SOCK 2>/dev/null)"
  eval "$(tmux show-environment -s SSH_CONNECTION 2>/dev/null)"
}

# Attach to the tmux session "scratch", creating it if needed. Inside tmux,
# switch to it instead of nesting.
scratch() {
  if [ -n "${TMUX:-}" ]; then
    tmux has-session -t =scratch 2>/dev/null || tmux new-session -d -s scratch
    tmux switch-client -t =scratch
  else
    tmux new-session -A -s scratch
  fi
}
