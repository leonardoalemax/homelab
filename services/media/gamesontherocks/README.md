# Games On The Rocks — acervo local

Baixa todos os episódios do podcast [Games On The Rocks](https://fourble.co.uk/podcast/gamesonthero)
(hospedados no archive.org) e os serve como um site estático na rede local.

## Como usar

1. **Baixar os episódios** (rodar na mão, demora — são ~190 arquivos):

   ```sh
   ./download.sh
   ```

   - Lê `STORAGE` do `.env` na raiz do repo (default `/mnt/valt`).
   - Salva os `.mp3` em `$STORAGE/gamesontherocks/episodes/`.
   - Gera `$STORAGE/gamesontherocks/index.html` (player + lista).
   - É idempotente: re-rodar pula os que já existem e retoma downloads incompletos.

2. **Subir o servidor HTTP:**

   ```sh
   docker compose up -d gamesontherocks
   ```

## Acesso

- Local: `http://<SERVER_LOCAL_IP>:8077`
- Via proxy: `http://gamesontherocks.<DOMAIN>`
  (template em `services/infra/nginx/templates/gamesontherocks.conf.template`)

Para atualizar o acervo quando saírem episódios novos, rode `./download.sh` de novo —
não precisa reiniciar o container (o `index.html` é regerado no volume).
