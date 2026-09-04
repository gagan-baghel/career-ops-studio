# Load the user's real config first, then pin the Node the workspace needs.
# .zshrc commonly rebuilds PATH from scratch (and nvm re-applies its default),
# so the workspace Node has to be prepended *after* it, not inherited.
[ -f "${USER_ZDOTDIR:-$HOME}/.zshrc" ] && . "${USER_ZDOTDIR:-$HOME}/.zshrc"
[ -n "$STUDIO_NODE_BIN" ] && export PATH="$STUDIO_NODE_BIN:$PATH"
