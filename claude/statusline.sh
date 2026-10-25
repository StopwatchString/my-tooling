#!/bin/sh
# Claude Code status line (statusLine in claude/settings.json). Reads the
# session JSON on stdin and prints one line:
#
#   user@host:~/dir · Opus 5.5 (1M context) · ctx 12% · now 34% (resets 15:40) · week 18% (resets Thu 09:00)
#
# user@host:dir is styled like the zsh prompt (shell/zsh/p10k.zsh). The usage
# figures are the claude.ai plan limits; Claude Code leaves them out for API
# keys and before the first response, and so does this. Needs jq.

input=$(cat)

# One jq pass, emitted as shell assignments; missing values come out empty.
eval "$(printf '%s' "$input" | jq -r '
  def pct: if . == null then "" else (. + 0.5 | floor | tostring) end;
  @sh "dir=\(.workspace.current_dir // .cwd // "")",
  @sh "model=\(.model.display_name // .model.id // "")",
  @sh "ctx=\(.context_window.used_percentage | pct)",
  @sh "five=\(.rate_limits.five_hour.used_percentage | pct)",
  @sh "five_reset=\(.rate_limits.five_hour.resets_at // "")",
  @sh "week=\(.rate_limits.seven_day.used_percentage | pct)",
  @sh "week_reset=\(.rate_limits.seven_day.resets_at // "")"
')" || exit 0

esc=$(printf '\033')
reset="$esc[0m" bold="$esc[1m" grey="$esc[38;5;244m"
green="$esc[32m" blue="$esc[34m" yellow="$esc[33m" red="$esc[31m"
sep=" $grey·$reset "

case $dir in
  "$HOME") dir='~' ;;
  "$HOME"/*) dir="~${dir#"$HOME"}" ;;
esac

# Epoch seconds -> local time (GNU date, then BSD/macOS date).
at() { date -d "@$1" "+$2" 2>/dev/null || date -r "$1" "+$2" 2>/dev/null; }

# Usage percentage, yellow from 70%, red from 90%.
level() {
  if [ "$1" -ge 90 ]; then printf '%s' "$red$1%$reset"
  elif [ "$1" -ge 70 ]; then printf '%s' "$yellow$1%$reset"
  else printf '%s' "$1%"
  fi
}

# label, percentage, reset epoch, reset date format
limit() {
  [ -n "$2" ] || return 0
  printf '%s%s %s' "$sep" "$1" "$(level "$2")"
  [ -n "$3" ] && when=$(at "$3" "$4") && printf ' %s' "$grey(resets $when)$reset"
  return 0
}

printf '%s' "$bold$green$(id -un)@$(hostname -s 2>/dev/null || hostname)$reset$grey:$reset$bold$blue$dir$reset"
[ -n "$model" ] && printf '%s%s' "$sep" "$model"
[ -n "$ctx" ] && printf '%sctx %s' "$sep" "$(level "$ctx")"
limit now "$five" "$five_reset" '%H:%M'
limit week "$week" "$week_reset" '%a %H:%M'
printf '\n'
