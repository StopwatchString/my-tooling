# shell/zsh/p10k.zsh — Powerlevel10k config, sourced by zshrc from the repo.
#
# Hand-trimmed equivalent of the wizard's output for: nerdfont-v3 + powerline,
# small icons, classic style, unicode, light, 24h time, angled separators,
# sharp heads, flat tails, 1 line, compact, few icons, concise. Then restyled
# to look like Ubuntu's bash prompt plus git:
#   user@host:~/full/path  main ⇡1 +2 !1 ?3
# `p10k configure` overwrites this file with a full generated config.

'builtin' 'local' '-a' 'p10k_config_opts'
[[ ! -o 'aliases'         ]] || p10k_config_opts+=('aliases')
[[ ! -o 'sh_glob'         ]] || p10k_config_opts+=('sh_glob')
[[ ! -o 'no_brace_expand' ]] || p10k_config_opts+=('no_brace_expand')
'builtin' 'setopt' 'no_aliases' 'no_sh_glob' 'brace_expand'

() {
  emulate -L zsh -o extended_glob

  # Start from a clean slate so a reload drops settings removed here.
  unset -m '(POWERLEVEL9K_*|DEFAULT_USER)~POWERLEVEL9K_GITSTATUS_DIR'

  autoload -Uz is-at-least && is-at-least 5.1 || return

  # Contents: user@host:path (dir joined to context, no gap) and git status,
  # nothing on the right.
  typeset -g POWERLEVEL9K_LEFT_PROMPT_ELEMENTS=(context dir_joined vcs)
  typeset -g POWERLEVEL9K_RIGHT_PROMPT_ELEMENTS=()

  # Look.
  typeset -g POWERLEVEL9K_MODE=nerdfont-v3
  typeset -g POWERLEVEL9K_ICON_PADDING=none
  typeset -g POWERLEVEL9K_ICON_BEFORE_CONTENT=
  typeset -g POWERLEVEL9K_PROMPT_ADD_NEWLINE=false
  typeset -g POWERLEVEL9K_BACKGROUND=                        # no background
  typeset -g POWERLEVEL9K_{LEFT,RIGHT}_{LEFT,RIGHT}_WHITESPACE=
  typeset -g POWERLEVEL9K_{LEFT,RIGHT}_SUBSEGMENT_SEPARATOR=' '
  typeset -g POWERLEVEL9K_{LEFT,RIGHT}_SEGMENT_SEPARATOR=' '
  typeset -g POWERLEVEL9K_LEFT_PROMPT_FIRST_SEGMENT_START_SYMBOL=
  typeset -g POWERLEVEL9K_LEFT_PROMPT_LAST_SEGMENT_END_SYMBOL=' '
  typeset -g POWERLEVEL9K_RIGHT_PROMPT_FIRST_SEGMENT_START_SYMBOL=
  typeset -g POWERLEVEL9K_RIGHT_PROMPT_LAST_SEGMENT_END_SYMBOL=
  typeset -g POWERLEVEL9K_VISUAL_IDENTIFIER_EXPANSION=       # few icons

  # Context: always user@host, bold green, then a grey colon.
  typeset -g POWERLEVEL9K_CONTEXT_FOREGROUND=2
  typeset -g POWERLEVEL9K_CONTEXT_TEMPLATE='%B%n@%m%b%244F:'

  # Directory: bold blue, never shortened.
  typeset -g POWERLEVEL9K_DIR_FOREGROUND=4
  typeset -g POWERLEVEL9K_DIR_CONTENT_EXPANSION='%B${P9K_CONTENT}%b'
  typeset -g POWERLEVEL9K_SHORTEN_STRATEGY=

  # Git: green icon + branch, then the indicators (see my_git_formatter).
  typeset -g POWERLEVEL9K_VCS_BACKENDS=(git)
  typeset -g POWERLEVEL9K_VCS_BRANCH_ICON='\uF126 '
  typeset -g POWERLEVEL9K_VCS_VISUAL_IDENTIFIER_EXPANSION=
  typeset -g POWERLEVEL9K_VCS_DISABLE_GITSTATUS_FORMATTING=true
  typeset -g POWERLEVEL9K_VCS_CONTENT_EXPANSION='${$((my_git_formatter(1)))+${my_git_format}}'
  typeset -g POWERLEVEL9K_VCS_LOADING_CONTENT_EXPANSION='${$((my_git_formatter(0)))+${my_git_format}}'
  typeset -g POWERLEVEL9K_VCS_{STAGED,UNSTAGED,UNTRACKED,CONFLICTED,COMMITS_AHEAD,COMMITS_BEHIND}_MAX_NUM=-1

  # Sets my_git_format from gitstatus's VCS_STATUS_* vars. Arg 1 is 0 while
  # the status is still loading, which greys everything out.
  function my_git_formatter() {
    emulate -L zsh
    if [[ -n $P9K_CONTENT ]]; then   # not something gitstatus handles
      typeset -g my_git_format=$P9K_CONTENT
      return
    fi
    local branch='%B%2F' green='%2F' yellow='%3F' blue='%4F' red='%1F' grey='%244F'
    (( $1 )) || branch='%244F' green=$grey yellow=$grey blue=$grey red=$grey

    local where
    if [[ -n $VCS_STATUS_LOCAL_BRANCH ]]; then where=$VCS_STATUS_LOCAL_BRANCH
    elif [[ -n $VCS_STATUS_TAG ]]; then        where="#$VCS_STATUS_TAG"
    else                                       where="@${VCS_STATUS_COMMIT[1,8]}"
    fi
    local res="${branch}${(g::)POWERLEVEL9K_VCS_BRANCH_ICON}${where//\%/%%}%b"

    # Remote branch, when its name differs from the local one.
    if [[ -n ${VCS_STATUS_REMOTE_BRANCH:#$VCS_STATUS_LOCAL_BRANCH} ]]; then
      res+="${grey}:${green}${VCS_STATUS_REMOTE_BRANCH//\%/%%}"
    fi
    (( VCS_STATUS_COMMITS_BEHIND )) && res+=" ${green}⇣${VCS_STATUS_COMMITS_BEHIND}"
    (( VCS_STATUS_COMMITS_AHEAD && !VCS_STATUS_COMMITS_BEHIND )) && res+=" "
    (( VCS_STATUS_COMMITS_AHEAD ))  && res+="${green}⇡${VCS_STATUS_COMMITS_AHEAD}"
    (( VCS_STATUS_STASHES ))        && res+=" ${green}*${VCS_STATUS_STASHES}"
    [[ -n $VCS_STATUS_ACTION ]]     && res+=" ${red}${VCS_STATUS_ACTION}"
    (( VCS_STATUS_NUM_CONFLICTED )) && res+=" ${red}~${VCS_STATUS_NUM_CONFLICTED}"
    (( VCS_STATUS_NUM_STAGED ))     && res+=" ${yellow}+${VCS_STATUS_NUM_STAGED}"
    (( VCS_STATUS_NUM_UNSTAGED ))   && res+=" ${yellow}!${VCS_STATUS_NUM_UNSTAGED}"
    (( VCS_STATUS_NUM_UNTRACKED ))  && res+=" ${blue}?${VCS_STATUS_NUM_UNTRACKED}"
    # -1 means the repo is too big to count unstaged changes (see bash.showDirtyState).
    (( VCS_STATUS_HAS_UNSTAGED == -1 )) && res+=" ${yellow}─"

    typeset -g my_git_format=$res
  }
  functions -M my_git_formatter 2>/dev/null

  # Command execution time (if the segment is added): 3s or more, as H:M:S.
  typeset -g POWERLEVEL9K_COMMAND_EXECUTION_TIME_THRESHOLD=3
  typeset -g POWERLEVEL9K_COMMAND_EXECUTION_TIME_PRECISION=0
  typeset -g POWERLEVEL9K_COMMAND_EXECUTION_TIME_FORMAT='H:M:S'

  # Time (if the segment is added): 24h.
  typeset -g POWERLEVEL9K_TIME_FORMAT='%D{%H:%M:%S}'

  # Behavior.
  typeset -g POWERLEVEL9K_TRANSIENT_PROMPT=off
  typeset -g POWERLEVEL9K_INSTANT_PROMPT=verbose
  typeset -g POWERLEVEL9K_DISABLE_HOT_RELOAD=true

  (( ! $+functions[p10k] )) || p10k reload
}

typeset -g POWERLEVEL9K_CONFIG_FILE=${${(%):-%x}:a}

(( ${#p10k_config_opts} )) && setopt ${p10k_config_opts[@]}
'builtin' 'unset' 'p10k_config_opts'
