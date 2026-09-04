# career-ops studio shim — defer to the user's own zsh config.
[ -f "${USER_ZDOTDIR:-$HOME}/.zshenv" ] && . "${USER_ZDOTDIR:-$HOME}/.zshenv"
