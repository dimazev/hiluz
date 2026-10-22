# חילוצי שטח – static site

A single static page (HTML + images, no build step) served by nginx in Docker.
Umami analytics and session replay are served first-party through nginx under `/stats/`.

## Layout

| Path | What |
|---|---|
| `site/index.html` | the whole page (inline CSS, tiny inline JS) |
| `site/*.avif`, `site/*.webp`, `site/og-image.jpg` | banner photo (3 sizes) and the social share image |
| `site/robots.txt`, `site/sitemap.xml` | SEO files (`__DOMAIN__` is replaced at build time) |
| `nginx.conf` | gzip, caching, security headers, `/stats/` proxy to Umami |
| `Dockerfile`, `docker-compose.yml` | image build and run |
| `update.sh` | pull the latest content, rebuild, restart, verify |
| `serve.mjs` | local preview server (F5 in VS Code, no Docker needed) |

## First install (on the server)

```bash
git clone https://github.com/dimazev/hiluz.git
cd hiluz
cp .env.example .env
nano .env            # set DOMAIN=https://your-domain.co.il  (and PORT if 8080 is taken)
docker compose up -d --build
```

Put your reverse proxy / HTTPS in front of `http://127.0.0.1:8080`.

## Upgrade to the latest version

```bash
cd hiluz
./update.sh
```

That does, in order:

1. `git pull --ff-only` (refuses if you have local edits to tracked files)
2. `docker compose build --pull` (fresh nginx base image + your new content)
3. `docker compose up -d` (replaces the container, a few seconds of downtime)
4. waits until the container is healthy, then checks `/stats/script.js`
5. removes old unused images

If you changed files directly on the server and want to deploy them without git:

```bash
./update.sh --no-pull
```

### Manual equivalent

```bash
git pull --ff-only
docker compose build --pull
docker compose up -d
```

## Rollback

```bash
git log --oneline            # find the last good commit
git checkout <commit>        # detached; or: git revert <bad-commit>
./update.sh --no-pull
```

## Change the domain

Edit `DOMAIN` in `.env`, then `./update.sh --no-pull`. The domain is baked into the canonical URL, sitemap, Open Graph tags and structured data at build time, so a rebuild is required.

## Local preview

In VS Code press **F5** ("Launch site"), or run `node serve.mjs 8080` and open http://localhost:8080.

## Troubleshooting

- **`docker compose logs web`** shows nginx logs.
- **Analytics missing:** `curl -I http://127.0.0.1:8080/stats/script.js` should return 200. If not, the container cannot reach `umami.dzev.net` (check DNS / firewall, and that Umami itself is up).
- **Page shows old content:** hard refresh. HTML is cached for 1 hour, images for 30 days (file names change when images change).
- **Port already in use:** change `PORT` in `.env`.
