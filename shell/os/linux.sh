# Linux-only shell setup (bash and zsh).

alias ls='ls --color=auto'
alias grep='grep --color=auto'

has_cmd apt && alias update='sudo apt update && sudo apt upgrade && sudo apt autoremove'
has_cmd fwupdmgr && alias update-firmware='sudo fwupdmgr refresh && sudo fwupdmgr update'
has_cmd determinate-nixd && alias update-nix='sudo determinate-nixd upgrade'
