# Read by every zsh, including scripts (the generated
# ~/.config/dotfiles/build/zshenv), so keep it to PATH-level setup.
# Interactive setup goes in rc.zsh; shell/common/env.sh repeats this for bash.

[ -f "$HOME/.cargo/env" ] && . "$HOME/.cargo/env"
