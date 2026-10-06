# bash interactive settings: history, prompt, completion. The last stage of
# the generated ~/.config/dotfiles/build/bashrc, after shell/common/.

HISTCONTROL=ignoreboth
HISTSIZE=10000
HISTFILESIZE=20000
shopt -s histappend checkwinsize

# Inside tmux, pick up the attaching client's ssh agent (shell/common/functions.sh).
[ -n "${TMUX:-}" ] && PROMPT_COMMAND="ssh-refresh${PROMPT_COMMAND:+; $PROMPT_COMMAND}"

# Completion (Linux system package, or Homebrew's bash-completion@2 on macOS).
if ! shopt -oq posix; then
  for _f in /usr/share/bash-completion/bash_completion /etc/bash_completion \
            "${HOMEBREW_PREFIX:-/opt/homebrew}/etc/profile.d/bash_completion.sh"; do
    if [ -r "$_f" ]; then . "$_f"; break; fi
  done
  unset _f
fi

PS1='\[\e[01;32m\]\u@\h\[\e[00m\]:\[\e[01;34m\]\w\[\e[00m\]\$ '
case "$TERM" in
  xterm*|rxvt*|tmux*|screen*) PS1="\[\e]0;\u@\h: \w\a\]$PS1" ;;
esac
