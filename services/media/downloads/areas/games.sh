#!/usr/bin/env bash
#
# downloads/areas/games — gerador da área "games" (hoje: só PS3)
#
# Varre ${STORAGE}/Games/ps3/isos, busca título/capa (GameTDB pelo Title ID
# do PS3 extraído do nome do arquivo, com fallback pro resumo da Wikipedia),
# e escreve ${STORAGE}/downloads/_data/games.json -- o manifest que o plugin
# Valtar (Sharkord) lê pra gerar os posts.
#
# Esse JSON também funciona como cache: uma entrada já presente (por id) não
# é buscada de novo nas APIs, só o tamanho/link são recalculados (são
# baratos, vêm do próprio arquivo local). Pra forçar re-busca de tudo, apague
# ${STORAGE}/downloads/_data/games.json antes de rodar.
#
# Cada área nova (futuramente) tem seu próprio script aqui em areas/, com seu
# próprio jeito de ler/formatar dados -- o plugin em si não sabe nada disso,
# só lê o JSON final no formato comum (id/title/description/image/link/buttons).
#
# Depende de: curl, jq
#
# Rodar na mão sempre que adicionar/remover ISOs:
#     ./games.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"

if [[ -f "$REPO_ROOT/.env" ]]; then
    # shellcheck disable=SC1091
    set -a; source "$REPO_ROOT/.env"; set +a
fi
STORAGE="${STORAGE:-/mnt/valt}"
DOMAIN="${DOMAIN:-example.com}"

ISOS_DIR="$STORAGE/Games/ps3/isos"
DATA_DIR="$STORAGE/downloads/_data"
GAMES_JSON="$DATA_DIR/games.json"
INDEX_JSON="$DATA_DIR/index.json"

if [[ ! -d "$ISOS_DIR" ]]; then
    echo "!! Pasta não encontrada: $ISOS_DIR" >&2
    exit 1
fi

mkdir -p "$DATA_DIR"

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

# acha um Title ID de PS3 no nome do arquivo, ex: BLUS30418, BLES-01234
extract_title_id() {
    local upper
    upper="$(echo "$1" | tr '[:lower:]' '[:upper:]')"
    if [[ "$upper" =~ ([A-Z]{4})[-_]?([0-9]{5}) ]]; then
        echo "${BASH_REMATCH[1]}${BASH_REMATCH[2]}"
    fi
}

# HTTP 200 numa das regiões do GameTDB -> devolve a URL da capa
gametdb_cover() {
    local id="$1" region
    for region in US EN; do
        local url="https://art.gametdb.com/ps3/cover/${region}/${id}.jpg"
        if curl -sfI --max-time 8 "$url" >/dev/null 2>&1; then
            echo "$url"
            return 0
        fi
    done
    return 1
}

# busca na Wikipedia (keyless) por título + thumbnail; stdout = "title\tthumb"
wikipedia_lookup() {
    local query="$1" encoded body title thumb
    encoded="$(echo "$query" | tr ' ' '_')"
    encoded="$(urlencode "$encoded")"
    body="$(curl -sf --max-time 8 "https://en.wikipedia.org/api/rest_v1/page/summary/${encoded}" 2>/dev/null)" || return 1
    [[ -z "$body" ]] && return 1
    title="$(echo "$body" | jq -r '.title // empty')"
    thumb="$(echo "$body" | jq -r '.thumbnail.source // empty')"
    [[ -z "$title" ]] && return 1
    printf '%s\t%s\n' "$title" "$thumb"
}

# limpa o nome do arquivo pra algo pesquisável: tira extensão, [tags],
# (tags) -- classe negada em vez de `*` greedy, ou um glob come tudo entre o
# primeiro '[' e o último ']' quando há mais de um grupo -- e troca
# underscores/pontos por espaço
clean_title() {
    local name="${1%.*}"
    name="$(echo "$name" | sed -E 's/\[[^][]*\]//g; s/\([^()]*\)//g')"
    name="$(echo "$name" | tr '._' ' ' | sed -E 's/ +/ /g; s/^ +| +$//g')"
    echo "$name"
}

EXISTING_JSON='{"entries":[]}'
[[ -f "$GAMES_JSON" ]] && EXISTING_JSON="$(cat "$GAMES_JSON")"

cached_entry() {
    echo "$EXISTING_JSON" | jq -c --arg id "$1" '.entries[] | select(.id == $id)' 2>/dev/null | head -1
}

TMP_ENTRIES="$(mktemp)"
trap 'rm -f "$TMP_ENTRIES"' EXIT

count=0
cache_hits=0
for file in "$ISOS_DIR"/*; do
    [[ -f "$file" ]] || continue

    filename="$(basename "$file")"
    id="$(slugify "${filename%.*}")"
    [[ -z "$id" ]] && id="jogo-$count"

    size="$(numfmt --to=iec --suffix=B "$(stat -c%s "$file")" 2>/dev/null || echo '?')"
    link="https://downloads.${DOMAIN}/games/ps3/isos/$(urlencode "$filename")"

    hit="$(cached_entry "$id")"

    if [[ -n "$hit" ]]; then
        title="$(echo "$hit" | jq -r '.title')"
        image="$(echo "$hit" | jq -r '.image // empty')"
        cache_hits=$((cache_hits + 1))
    else
        title=""
        image=""

        title_id="$(extract_title_id "$filename")"
        if [[ -n "$title_id" ]]; then
            image="$(gametdb_cover "$title_id" || true)"
        fi

        search_title="$(clean_title "$filename")"
        if [[ -z "$image" || -z "$title" ]]; then
            wiki="$(wikipedia_lookup "$search_title" || true)"
            if [[ -n "$wiki" ]]; then
                title="$(cut -f1 <<<"$wiki")"
                [[ -z "$image" ]] && image="$(cut -f2 <<<"$wiki")"
            fi
        fi

        [[ -z "$title" ]] && title="$search_title"
    fi

    jq -n \
        --arg id "$id" \
        --arg title "$title" \
        --arg description "PS3 · $size" \
        --arg image "$image" \
        --arg link "$link" \
        '{id: $id, title: $title, description: $description,
          image: (if $image == "" then null else $image end), link: $link,
          buttons: [{label: "Download", url: $link}]}' \
        >> "$TMP_ENTRIES"

    count=$((count + 1))
    printf '  %-9s %s\n' "$([[ -n "$image" ]] && echo "ok" || echo "sem-capa")" "$title"
done

jq -s '{area: "games", channel: "Games", entries: .}' "$TMP_ENTRIES" > "$GAMES_JSON"

# upsert desta área no índice, preservando outras áreas já listadas
EXISTING_INDEX='{"areas":[]}'
[[ -f "$INDEX_JSON" ]] && EXISTING_INDEX="$(cat "$INDEX_JSON")"
echo "$EXISTING_INDEX" | jq \
    '.areas = ([.areas[]? | select(.name != "games")] + [{name: "games", channel: "Games", manifest: "/_data/games.json"}])' \
    > "$INDEX_JSON"

echo
echo "==> $count jogo(s) de PS3 em $GAMES_JSON ($cache_hits do cache)"
echo "    No Sharkord, rode:  /sync-valt"
