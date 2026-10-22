# חילוצי שטח – static site

One static page (HTML + images, no build step) served by nginx in Docker.
Umami analytics is served first-party through nginx under `/stats/` (no third-party cookies).

## Contents

- [Start (first time)](#start-first-time)
- [Day-to-day commands](#day-to-day-commands)
- [Upgrade to the latest version](#upgrade-to-the-latest-version)
- [Rollback](#rollback)
- [Local preview (no Docker)](#local-preview-no-docker)
- [Configuration](#configuration)
- [Project layout](#project-layout)
- [Troubleshooting](#troubleshooting)

## Start (first time)

Requirements on the server: Docker with the `docker compose` plugin, `git`, `curl`.

```bash
git clone https://github.com/dimazev/hiluz.git
cd hiluz
./update.sh --domain https://your-domain.co.il
```

One script does both the first install and every later upgrade. On the first run it creates `.env`
(it asks for the domain if you do not pass `--domain`), builds the image, starts the container,
waits for the health check and tests the site and the analytics proxy.

Options: `--domain URL`, `--port N`, `--no-pull` (skip `git pull`), `--help`.

**Port:** the script scans for a free port starting at 8080 on the first run and saves it as `PORT` in `.env`,
so every later upgrade reuses it. If the saved port gets taken by another program while the site is not running,
it picks the next free one and updates `.env`. `--port N` forces a port (and fails if it is busy).
The final port is printed at the end of the run.

The site then listens on `http://127.0.0.1:${PORT}`. Put your HTTPS reverse proxy
(Caddy, nginx, Traefik, Cloudflare Tunnel...) in front of it and point your domain there.

Manual alternative (without the script):

```bash
cp .env.example .env && nano .env       # set DOMAIN and PORT
docker compose up -d --build
```

`DOMAIN` must be the real public address: it is written into the canonical URL, sitemap,
Open Graph tags, share links and Google structured data when the image is built.

## Day-to-day commands

```bash
docker compose ps                  # status / health
docker compose logs -f web         # live nginx logs
docker compose restart web         # restart
docker compose stop                # stop
docker compose start               # start again
docker compose down                # stop and remove the container (the site is stateless, nothing is lost)
```

The container restarts by itself after a server reboot (`restart: unless-stopped`).

## Upgrade to the latest version

On the server, from the project folder:

```bash
./update.sh
```

What it does, in order:

1. reads `.env` (creates it on the first run) and validates the domain and port;
2. `git pull --ff-only` (stops if you have uncommitted edits to tracked files);
3. `docker compose build --pull` (fresh nginx base image + the new content);
4. `docker compose up -d` (replaces the container, a few seconds of downtime);
5. waits for the health check, then verifies `/stats/script.js` returns 200;
6. removes old unused images.

Deploy files you edited directly on the server (no git):

```bash
./update.sh --no-pull
```

Manual equivalent:

```bash
git pull --ff-only
docker compose build --pull
docker compose up -d
```

Publishing a change from your computer: commit and `git push`, then run `./update.sh` on the server.

## Rollback

```bash
git log --oneline              # find the last good commit
git checkout <commit>          # or: git revert <bad-commit> and push
./update.sh --no-pull
```

To go back to the newest version afterwards: `git checkout main && ./update.sh`.

## Local preview (no Docker)

- **VS Code:** open the folder and press **F5** ("Launch site"). It opens http://localhost:8080.
- **Terminal:** `node serve.mjs 8080` (needs Node only).

The preview server mirrors production: it replaces the domain placeholder, proxies `/stats/`
to Umami and gzips text. HTML is never cached, so edit and refresh. Restart it after changing `serve.mjs`.

## Configuration

| Setting | Where | Notes |
|---|---|---|
| `DOMAIN` | `.env` | public address, baked in at build time, so rebuild after changing: `./update.sh --no-pull` |
| `PORT` | `.env` | host port published by Docker; auto-selected (first free from 8080) and saved by `update.sh`, or force with `--port` |
| phone / WhatsApp | `site/index.html` | search for `972508887544` / `050-888-7544` |
| Umami website id | `site/index.html` | `data-website-id`, appears twice (analytics + replay) |
| Umami server | `nginx.conf`, `serve.mjs` | `umami.dzev.net` in the `/stats/` proxy |

Analytics events (visible in Umami): `call-click`, `whatsapp-click`, `share-facebook`,
`share-instagram`, `share-tiktok`. Session replay loads only after a visitor touches the page.

## Project layout

| Path | What |
|---|---|
| `site/index.html` | the whole page (inline CSS and small inline JS) |
| `site/hilutz-shetach-silverado-razer-*.avif/.webp` | banner photo in 480/640/800/1024 px |
| `site/og-image.jpg` | image shown when the link is shared |
| `site/robots.txt`, `site/sitemap.xml` | SEO files (`__DOMAIN__` replaced at build time) |
| `nginx.conf` | gzip, caching, security headers, `/stats/` proxy |
| `Dockerfile`, `docker-compose.yml` | image and container |
| `update.sh` | pull, rebuild, restart, verify |
| `serve.mjs` | local preview server |
| `.vscode/` | F5 launch configuration and Docker tasks |

## Troubleshooting

- **Container not healthy:** `docker compose logs --tail=50 web`.
- **Analytics missing:** `curl -I http://127.0.0.1:8080/stats/script.js` must return 200. If not, the
  server cannot reach `umami.dzev.net` (DNS/firewall), or Umami itself is down. The page works without it.
- **Old content after upgrade:** hard refresh. HTML is cached 1 hour, images 30 days (image file names change when images change).
- **`update.sh` says local changes:** `git status`, then commit, `git stash`, or use `./update.sh --no-pull`.
- **Port already in use:** run `./update.sh` (it picks and saves a free port), or force one with `--port N`.
- **Wrong domain in sitemap or share links:** fix `DOMAIN` in `.env`, then `./update.sh --no-pull`.
