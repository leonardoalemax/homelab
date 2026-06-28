#!/usr/bin/env bash
#
# Games On The Rocks — baixador de episódios
#
# Raspa a página do fourble.co.uk, baixa TODOS os episódios (.mp3) para
# ${STORAGE}/gamesontherocks/episodes e gera um index.html listando tudo.
#
# Rodar na mão sempre que quiser baixar/atualizar o acervo:
#     ./download.sh
#
# O container HTTP (gamesontherocks.yml) serve a pasta gerada na rede local.

set -euo pipefail

SOURCE_URL="https://fourble.co.uk/podcast/gamesonthero"
TITLE="Games On The Rocks"

# ── Descobre a raiz do repo e carrega STORAGE do .env ────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

if [[ -f "$REPO_ROOT/.env" ]]; then
    # shellcheck disable=SC1091
    set -a; source "$REPO_ROOT/.env"; set +a
fi
STORAGE="${STORAGE:-/mnt/valt}"

WEB_ROOT="$STORAGE/gamesontherocks"
EPISODES_DIR="$WEB_ROOT/episodes"
INDEX_FILE="$WEB_ROOT/index.html"

mkdir -p "$EPISODES_DIR"

echo "==> Origem : $SOURCE_URL"
echo "==> Destino: $EPISODES_DIR"
echo

# ── Raspa a página: pares (url, título) ──────────────────────────────────────
PAGE="$(curl -fsSL "$SOURCE_URL")"

# Cada episódio: <a href="...mp3">Título</a>
mapfile -t LINES < <(
    printf '%s' "$PAGE" \
    | grep -oE '<a href="https?://[^"]+\.mp3">[^<]*</a>'
)

TOTAL="${#LINES[@]}"
if [[ "$TOTAL" -eq 0 ]]; then
    echo "!! Nenhum episódio encontrado. A página pode ter mudado de estrutura." >&2
    exit 1
fi
echo "==> $TOTAL episódios encontrados"
echo

# decodifica entidades html básicas
html_unescape() {
    sed -e 's/&amp;/\&/g' -e 's/&lt;/</g' -e 's/&gt;/>/g' \
        -e 's/&quot;/"/g' -e "s/&#39;/'/g"
}

# transforma um título num nome de arquivo seguro
slugify() {
    echo "$1" \
        | iconv -t ascii//TRANSLIT 2>/dev/null \
        | tr '[:upper:]' '[:lower:]' \
        | sed -E 's/[^a-z0-9]+/_/g; s/^_+|_+$//g'
}

# escapa para uso seguro dentro do HTML
html_escape() {
    sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g' -e 's/"/\&quot;/g'
}

declare -a EP_TITLES EP_FILES

i=0
for line in "${LINES[@]}"; do
    i=$((i + 1))
    url="$(sed -E 's/.*href="([^"]+)".*/\1/' <<<"$line")"
    title="$(sed -E 's/.*>([^<]*)<.*/\1/' <<<"$line" | html_unescape)"
    [[ -z "$title" ]] && title="Episódio $i"

    num="$(printf '%03d' "$i")"
    slug="$(slugify "$title")"
    [[ -z "$slug" ]] && slug="episodio"
    filename="${num}_${slug}.mp3"
    dest="$EPISODES_DIR/$filename"

    EP_TITLES+=("$title")
    EP_FILES+=("$filename")

    if [[ -s "$dest" ]]; then
        printf '[%3d/%d] skip  %s\n' "$i" "$TOTAL" "$filename"
        continue
    fi

    printf '[%3d/%d] baixa %s\n' "$i" "$TOTAL" "$filename"
    # -C - retoma downloads interrompidos; baixa para .part e só move ao concluir
    if curl -fL --retry 3 --retry-delay 2 -C - -o "$dest.part" "$url"; then
        mv -f "$dest.part" "$dest"
    else
        echo "    !! falhou: $url" >&2
        rm -f "$dest.part"
    fi
done

# ── Gera o index.html ────────────────────────────────────────────────────────
echo
echo "==> Gerando $INDEX_FILE"

GENERATED_AT="$(date '+%Y-%m-%d %H:%M')"

{
cat <<HTML
<!DOCTYPE html>
<html lang="pt-br">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${TITLE} — Acervo</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    background: #0e1116; color: #e6e6e6; line-height: 1.4;
  }
  header {
    padding: 28px 20px; background: linear-gradient(135deg,#1b2735,#2c1810);
    border-bottom: 1px solid #2a2f3a;
  }
  header h1 { margin: 0 0 4px; font-size: 1.6rem; }
  header p  { margin: 0; color: #9aa4b2; font-size: .9rem; }
  main { max-width: 860px; margin: 0 auto; padding: 16px; }
  .ep {
    background: #161b22; border: 1px solid #232a33; border-radius: 10px;
    padding: 14px 16px; margin: 12px 0;
  }
  .ep h2 { margin: 0 0 8px; font-size: 1rem; font-weight: 600; }
  .ep .num { color: #f0883e; font-variant-numeric: tabular-nums; margin-right: 6px; }
  audio { width: 100%; margin-top: 4px; }
  .dl { font-size: .8rem; color: #58a6ff; text-decoration: none; }
  .dl:hover { text-decoration: underline; }
  footer { text-align: center; color: #6b7280; font-size: .8rem; padding: 24px; }
</style>
</head>
<body>
<header>
  <h1>🎮🥃 ${TITLE}</h1>
  <p>${TOTAL} episódios · acervo local · atualizado em ${GENERATED_AT}</p>
</header>
<main>
HTML

for idx in "${!EP_FILES[@]}"; do
    n="$(printf '%03d' "$((idx + 1))")"
    t="$(html_escape <<<"${EP_TITLES[$idx]}")"
    f="${EP_FILES[$idx]}"
    cat <<HTML
  <article class="ep">
    <h2><span class="num">#${n}</span>${t}</h2>
    <audio controls preload="none" src="episodes/${f}"></audio>
    <div><a class="dl" href="episodes/${f}" download>⬇ baixar mp3</a></div>
  </article>
HTML
done

cat <<HTML
</main>
<footer>Fonte: <a class="dl" href="${SOURCE_URL}">${SOURCE_URL}</a></footer>
</body>
</html>
HTML
} > "$INDEX_FILE"

echo
echo "==> Pronto! $TOTAL episódios em $EPISODES_DIR"
echo "    Suba o container:  docker compose up -d gamesontherocks"
