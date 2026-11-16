#!/usr/bin/env bash
#
# gamefiles — gerador de conteúdo pro plugin games-feed do Sharkord
#
# Varre ${STORAGE}/Games/ps3/isos e gera um .md por arquivo em
# services/apps/sharkord/games-content/games/ps3/, no formato que o plugin
# games-feed lê (mesmo frontmatter do apps-feed: title/link/description/buttons).
#
# Rodar na mão sempre que adicionar/remover ISOs:
#     ./generate-content.sh
#
# O link gerado aponta pro container gamefiles (gamefiles.yml), que serve
# ${STORAGE}/Games inteiro via HTTP por trás do proxy gamefiles.${DOMAIN}.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

if [[ -f "$REPO_ROOT/.env" ]]; then
    # shellcheck disable=SC1091
    set -a; source "$REPO_ROOT/.env"; set +a
fi
STORAGE="${STORAGE:-/mnt/valt}"
DOMAIN="${DOMAIN:-example.com}"

ISOS_DIR="$STORAGE/Games/ps3/isos"
CONTENT_DIR="$REPO_ROOT/services/apps/sharkord/games-content/games/ps3"

if [[ ! -d "$ISOS_DIR" ]]; then
    echo "!! Pasta não encontrada: $ISOS_DIR" >&2
    exit 1
fi

# percent-encode pra usar no link (espaços, [], (), acentos são comuns em ISOs)
urlencode() {
    local s="$1" out="" c i
    for ((i = 0; i < ${#s}; i++)); do
        c="${s:$i:1}"
        case "$c" in
            [a-zA-Z0-9.~_-]) out+="$c" ;;
            *) printf -v hex '%%%02X' "'$c"; out+="$hex" ;;
        esac
    done
    echo "$out"
}

slugify() {
    echo "$1" \
        | iconv -t ascii//TRANSLIT 2>/dev/null \
        | tr '[:upper:]' '[:lower:]' \
        | sed -E 's/[^a-z0-9]+/-/g; s/^-+|-+$//g'
}

# limpa e regenera do zero -- simples e idempotente, remove sozinho o .md de
# qualquer ISO que tenha sido apagado desde a última execução
rm -rf "$CONTENT_DIR"
mkdir -p "$CONTENT_DIR"

count=0
for file in "$ISOS_DIR"/*; do
    [[ -f "$file" ]] || continue

    filename="$(basename "$file")"
    title="${filename%.*}"
    slug="$(slugify "$title")"
    [[ -z "$slug" ]] && slug="jogo-$count"

    size="$(numfmt --to=iec --suffix=B "$(stat -c%s "$file")" 2>/dev/null || echo '?')"
    link="https://gamefiles.${DOMAIN}/ps3/isos/$(urlencode "$filename")"

    cat > "$CONTENT_DIR/${slug}.md" <<EOF
---
title: ${title}
link: ${link}
description: ISO de PS3 · ${size}
buttons: Download=${link}
---
EOF

    count=$((count + 1))
    printf '  ok  %s (%s)\n' "$title" "$size"
done

echo
echo "==> $count ISO(s) de PS3 em $CONTENT_DIR"
echo "    No Sharkord, rode:  /sync-games"
