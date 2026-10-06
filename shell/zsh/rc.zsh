# zsh interactive settings: history, options, completion, keys, plugins and
# prompt. The last stage of the generated ~/.config/dotfiles/build/zshrc.

HISTFILE="$HOME/.histfile"   # zsh-newuser-install default; keeps existing history
HISTSIZE=10000
SAVEHIST=20000
setopt EXTENDED_HISTORY HIST_IGNORE_ALL_DUPS HIST_IGNORE_SPACE HIST_REDUCE_BLANKS SHARE_HISTORY
setopt AUTO_CD EXTENDED_GLOB NOMATCH NOTIFY INTERACTIVE_COMMENTS NO_BEEP

# EXTENDED_GLOB makes `#` a glob operator, which breaks flake refs like .#shell.
alias nix='noglob nix'

# Completion: menu selection, case-insensitive matching.
zmodload zsh/complist
autoload -Uz compinit && compinit
zstyle ':completion:*' menu select
zstyle ':completion:*' matcher-list 'm:{a-zA-Z}={A-Za-z}'

# Vi mode, with a 10ms Esc timeout.
bindkey -v
KEYTIMEOUT=1

# Up/Down search history by the typed prefix; Ctrl-Left/Right move by word;
# Home/End/Delete do the usual. Both the terminfo keys and the common raw
# sequences are bound, since zle doesn't switch the terminal to keypad mode.
autoload -Uz up-line-or-beginning-search down-line-or-beginning-search
zle -N up-line-or-beginning-search
zle -N down-line-or-beginning-search
_bindkeys() {
  local widget=$1 seq; shift
  for seq in "$@"; do
    [[ -n $seq ]] && bindkey -M viins "$seq" $widget && bindkey -M vicmd "$seq" $widget
  done
}
_bindkeys up-line-or-beginning-search   "${terminfo[kcuu1]}" '^[[A' '^[OA'
_bindkeys down-line-or-beginning-search "${terminfo[kcud1]}" '^[[B' '^[OB'
_bindkeys backward-word                 '^[[1;5D' '^[[5D'
_bindkeys forward-word                  '^[[1;5C' '^[[5C'
_bindkeys beginning-of-line             "${terminfo[khome]}" '^[[H' '^[OH' '^[[1~' '^[[7~'
_bindkeys end-of-line                   "${terminfo[kend]}"  '^[[F' '^[OF' '^[[4~' '^[[8~'
_bindkeys delete-char                   "${terminfo[kdch1]}" '^[[3~'
unfunction _bindkeys

# Steady (non-blinking) block cursor, reset before every prompt.
autoload -Uz add-zsh-hook
_cursor_block() { print -n '\e[2 q' }
add-zsh-hook precmd _cursor_block

# Inside tmux, pick up the attaching client's ssh agent (shell/common/functions.sh).
[[ -n ${TMUX:-} ]] && add-zsh-hook precmd ssh-refresh

# Fallback prompt; replaced by Powerlevel10k below when it's available.
PROMPT='%B%F{green}%n@%m%f%b:%B%F{blue}%~%f%b%(!.#.$) '
export PATH="$HOME/.local/bin:$PATH"

_zplugins="$DOTFILES_LAYER/shell/zsh/plugins"

# zsh-autosuggestions: suggest from history, then completion; Ctrl-Space accepts.
if [[ -f $_zplugins/zsh-autosuggestions/zsh-autosuggestions.zsh ]]; then
  ZSH_AUTOSUGGEST_STRATEGY=(history completion)
  ZSH_AUTOSUGGEST_HIGHLIGHT_STYLE='fg=244'
  . "$_zplugins/zsh-autosuggestions/zsh-autosuggestions.zsh"
  bindkey '^ ' autosuggest-accept
fi

# Powerlevel10k, with its config kept in the repo. `p10k configure` writes
# straight back to shell/zsh/p10k.zsh.
if [[ -f $_zplugins/powerlevel10k/powerlevel10k.zsh-theme ]]; then
  . "$_zplugins/powerlevel10k/powerlevel10k.zsh-theme"
  POWERLEVEL9K_CONFIG_FILE="$DOTFILES_LAYER/shell/zsh/p10k.zsh"
  . "$POWERLEVEL9K_CONFIG_FILE"
fi
unset _zplugins
