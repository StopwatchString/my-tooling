# Linux-only shell setup (bash and zsh).

# Ubuntu's stock ~/.bashrc color setup, so zsh gets it too.
has_cmd dircolors && eval "$(dircolors -b)"
alias ls='ls --color=auto'
alias grep='grep --color=auto'

has_cmd apt && alias update='sudo apt update && sudo apt upgrade && sudo apt autoremove'
has_cmd fwupdmgr && alias update-firmware='sudo fwupdmgr refresh && sudo fwupdmgr update'
has_cmd determinate-nixd && alias update-nix='sudo determinate-nixd upgrade'
