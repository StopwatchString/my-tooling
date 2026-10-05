we are going to pull in settings from antoehr repo. I'm just pulling in text that summarizes the stuff that the other repo has that we need to represnt

shell: zsh
history: EXTENDED_HIOSTRY, HIST-IGNORE_ALL_DUPS, HIST_IGNORE_SPACE, HIS_REDUCE_BLANKS, SHARE_HISTORY
options: AUTO_CD, EXTENDED_GLOB, NOMATCH, NOTIFY, INTERACTVIE_COMMETNS, NO_BEEP
inix aliased to noglob nix so .#shell works with EXTENDED_GLOB
Completion: compinit, menu selection, case-insensitive matching
Vi mode (bindkey -v) with KEYTIMEOUT=1 (10ms Esc)
Key bindings
    -Up/Down search history by the typed prefix.
    -Ctrl-left/right move by word
    - home/end go to line start/end, delete deletes a character
Steady (non--blidnkning) block cursor, reset before every rpompt
reload re0-sources ~/.zshrc
typeset -U path dedupes PATH
Self-healing submoudle init for the zsh plugins on a fresh clone
Repo found from its own path (MSPECK_TOOLING_PATH), so the clone can move
Plugins;
    - Powerlevel10k, with its config kept int he repo
    -zsh-autosuggestions: strategy ()history completeion), highlihg fg=244, accept with ctrl-space

shell: powerlelvel10k zsh/p10k.zsh
wizard choices (header): nerdfont-v3 + powerline, small icons, classic style, unicode, light, 24h time, angled separators, sharep heads, flat tails, 1 line, compact, few icons, concise.
Prompt contents: only `context` (user@host) and idr_joined on the left, nonhing on the right
Look: no background, separater is a psace, no start symbol, no blank line before the prompt, ICON_PADDING=none
Diretory: foreground color 31, truncate_to_unique shortening
Command exectuion time shown at 3s or more, time format %H:%M:%S
Prompt behavior: transient prompt off, instnat propmt verbose, hot reload disabled

Shell: bash
- Keeps the distro ~/.bashrc and appends a source line
- Sets MSPECK_TOOLING_PATH and its own reload

Shell: shared (shell/common.sh)
ubuntu's ls/grep color aliases, so zsh gets them too, plus ll/la/l
PATH: ~/go/bin
EDITOR/VISUAL=nvim
ssh-refresh: tmux panes follow whoever attached last, locla, or SSH runs it beofr every prompt inside tmux (to make sure forwarding will work)

TMUX: in addition to what's already here, the 'scratch' alias that either creates or opens a tmux instance called 'scratch'

Terminal and fonts
Fonts: UbuntuMono Nerd Font Mono TTFS in fonts/, installed by scripts/install-fonts.sh, which also sets the termianl font.
Profile synce scripts/gnome-termianl-profile.sh load|export
GNOME Terminal (gnome-terminal/profile.dconf
    - Solarized Dark: background #002b36, foreground #839496, full 16-colour palette
    - UbuntuMono Nerd Font Mono 13, no system font, no theme colours, bell off

Cheat sheet script that says what's in the repo

The setup script for the repo should be idempotent (think that's already the case)
