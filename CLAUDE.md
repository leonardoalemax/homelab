# Homelab — Context Cache

## Visão geral

Repositório de infraestrutura self-hosted gerenciado via Docker Compose. Todos os serviços rodam em um único servidor Linux com armazenamento centralizado montado em `$STORAGE`.

## Variáveis de ambiente principais

| Variável | Descrição |
|---|---|
| `PREFIX` | Prefixo dos containers (`almx-lab`) |
| `STORAGE` | Raiz do armazenamento físico (`/mnt/valt`) |
| `DOMAIN` | Domínio público raiz |
| `SERVER_LOCAL_IP` | IP local do servidor |

Arquivo de referência: [`.env.example`](.env.example)

## Estrutura do projeto

```
.
├── docker-compose.yml          # Entry point — inclui todos os serviços via `include:`
├── Makefile                    # Atalhos (make sync-remotes)
├── services/
│   ├── infra/                  # Serviços de infraestrutura
│   │   ├── nginx.yml           # Reverse proxy
│   │   ├── nginx/              # Config nginx (nginx.conf, log.conf, templates/)
│   │   ├── postgres.yml        # Banco de dados
│   │   ├── postgres/init.sql   # SQL inicial
│   │   ├── portainer.yml       # UI Docker
│   │   ├── cloudflare-ddns.yml # DDNS automático via Cloudflare
│   │   ├── syncthing.yml       # Sync de arquivos
│   │   ├── filebrowser.yml     # Browser de arquivos via web
│   │   ├── samba.yml           # Compartilhamento de rede SMB
│   │   └── samba/config.yml    # Usuários e shares do Samba
│   ├── apps/
│   │   ├── qbittorrent.yml     # Cliente torrent
│   │   └── rdtclient.yml       # Real-Debrid client
│   └── media/
│       ├── jellyfin.yml        # Media server
│       ├── gamesontherocks.yml # HTTP server (acervo do podcast Games On The Rocks)
│       ├── gamesontherocks/    # download.sh (baixa episódios) + README
│       ├── maloja.yml          # Scrobbling server (Last.fm alternativo)
│       └── scrobbler.yml       # multi-scrobbler (agrega fontes → Maloja)
└── apps/
    └── remotes/                # Apps externos clonados via sync.sh
        ├── remotes.conf        # Lista de repos git a clonar
        └── sync.sh             # Script de clone/pull dos remotes
```

## Serviços e portas

| Container | Imagem | Porta(s) | Notas |
|---|---|---|---|
| nginx | nginx:latest | 80, 443 | Reverse proxy; templates em `services/infra/nginx/templates/` |
| portainer | portainer-ce | 9443 | UI Docker |
| cloudflare-ddns | favonia/cloudflare-ddns | host | Atualiza DNS Cloudflare automaticamente |
| syncthing | syncthing/syncthing | 8384, 22000, 21027 | Sync p2p de arquivos |
| filebrowser | hurlenko/filebrowser | 4430 | Servido em `/filebrowser` |
| samba | crazymax/samba | host | Share: `/samba/archive` → `$STORAGE` |
| postgres | postgres:14 | — (interno) | Init via `init.sql`; dados em `$STORAGE/postgres-db` |
| qbittorrent | linuxserver/qbittorrent | 8090, 6881 | Config/data/downloads em `$STORAGE/torrents/` |
| rdtclient | rogerfar/rdtclient | 6500 | DB e downloads em `$STORAGE/rdt/` |
| jellyfin | linuxserver/jellyfin | 8096, 8920, 7359, 1900 | Library em `$STORAGE/jellyfin/` |
| gamesontherocks | nginx:alpine | 8077 | Serve `$STORAGE/gamesontherocks` (acervo do podcast); povoado por `download.sh` |
| maloja | krateng/maloja | 42010 | Dados em `$STORAGE/mljdata` |
| scrobbler | foxxmd/multi-scrobbler | 9078 | Agrega fontes e envia para Maloja |

## Nginx — templates de virtual hosts

Cada serviço exposto externamente tem um arquivo `.conf.template` em `services/infra/nginx/templates/`. As variáveis `${SERVER_DOMAIN}` e `${SERVER_LOCAL_IP}` são injetadas via env no container nginx.

Templates existentes: `scrobbler`, `gitea`, `kavita`, `torrent`, `pokeapi`, `rdtclient`, `cfnview`, `gamesontherocks`.

## Apps remotos (`apps/remotes/`)

`sync.sh` lê `remotes.conf` e faz `git clone` ou `git pull --ff-only` de cada repo listado para `apps/remotes/<nome>/`. Cada app remoto pode ter seu próprio `service.yml` referenciado no `docker-compose.yml` raiz.

App remoto atual: `cfnview` (incluído em `docker-compose.yml` via `apps/remotes/cfnview/.homelab/service.yml`).

## Padrões e convenções

- Todo serviço é um arquivo `.yml` separado incluído no `docker-compose.yml` raiz via `include:`.
- Todos os containers usam `name: base` para compartilhar a mesma rede Docker.
- Nomes de containers seguem o padrão `${PREFIX}-<nome>`.
- Volumes de dados sempre apontam para subdiretórios de `${STORAGE}`.
- `PUID=1000` / `PGID=1000` é o padrão usado nos serviços linuxserver.
- Timezone padrão: `America/Sao_Paulo` (exceto onde indicado).

## Como adicionar um novo serviço

1. Criar `services/<categoria>/<nome>.yml` com `name: base` e o bloco `services:`.
2. Adicionar o path no `include:` do `docker-compose.yml` raiz.
3. Se exposto externamente, criar `services/infra/nginx/templates/<nome>.conf.template`.
4. Variáveis sensíveis vão em `.env` (usar `.env.example` como referência).
