#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONF="$SCRIPT_DIR/remotes.conf"

while IFS= read -r repo || [[ -n "$repo" ]]; do
  [[ "$repo" =~ ^#|^$ ]] && continue

  name="$(basename "$repo" .git)"
  target="$SCRIPT_DIR/$name"

  if [[ -d "$target/.git" ]]; then
    echo "==> pulling $name"
    git -C "$target" pull --ff-only
  else
    echo "==> cloning $name"
    git clone "$repo" "$target"
  fi
done < "$CONF"
