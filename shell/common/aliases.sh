# Aliases shared by bash and zsh. OS-specific ones live in shell/os/.

alias ll='ls -alF'
alias la='ls -A'
alias l='ls -CF'

alias dev='cd "$DEV"'
alias dotfiles='cd "$DOTFILES"'
alias cheat='"$DOTFILES/scripts/cheatsheet.sh"'

# Reload the current shell's rc files (dotfiles if linked, stock otherwise).
if [ -n "${BASH:-}" ]; then
  alias reload='source ~/.bashrc'
else
  alias reload='source ~/.zshrc'
fi
