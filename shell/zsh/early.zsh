# zsh setup that has to come first: the stage before shell/common/ in the
# generated ~/.config/dotfiles/build/zshrc. Anything that prints or reads
# input must happen here, above the Powerlevel10k instant prompt.

# Plugins are git submodules. On a fresh clone (no --recursive) fetch them
# once; anything printed here comes before p10k's instant prompt, so it's fine.
_zplugins="$DOTFILES_LAYER/shell/zsh/plugins"
if [[ ! -f $_zplugins/powerlevel10k/powerlevel10k.zsh-theme ||
      ! -f $_zplugins/zsh-autosuggestions/zsh-autosuggestions.zsh ]] && (( $+commands[git] )); then
  print -u2 "zshrc: fetching zsh plugin submodules..."
  git -C "$DOTFILES_LAYER" submodule update --init --depth 1 -- \
    shell/zsh/plugins/powerlevel10k shell/zsh/plugins/zsh-autosuggestions >&2
fi
unset _zplugins

# Powerlevel10k instant prompt. Keep near the top; anything needing console
# input (password prompts, [y/n] confirmations) must go above this block.
if [[ -r "${XDG_CACHE_HOME:-$HOME/.cache}/p10k-instant-prompt-${(%):-%n}.zsh" ]]; then
  source "${XDG_CACHE_HOME:-$HOME/.cache}/p10k-instant-prompt-${(%):-%n}.zsh"
fi

typeset -gU path   # dedupe PATH
