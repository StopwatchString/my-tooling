# macOS-only shell setup (bash and zsh).

# Homebrew: Apple Silicon installs to /opt/homebrew, Intel to /usr/local.
for _brew in /opt/homebrew/bin/brew /usr/local/bin/brew; do
  if [ -x "$_brew" ]; then
    eval "$("$_brew" shellenv)"
    break
  fi
done
unset _brew

export CLICOLOR=1
alias grep='grep --color=auto'

has_cmd brew && alias update='brew update && brew upgrade && brew cleanup'
has_cmd determinate-nixd && alias update-nix='sudo determinate-nixd upgrade'
