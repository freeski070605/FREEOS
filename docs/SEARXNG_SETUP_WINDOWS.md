# SearXNG setup for FREEOS on Windows

SearXNG gives FREEOS live web search without a paid search API key. FREEOS expects it at `http://127.0.0.1:8080` by default and requests its JSON search endpoint.

Set a different local, network, or self-hosted instance in `.env`:

```env
SEARXNG_BASE_URL=http://127.0.0.1:8080
```

## Recommended local setup on Windows

FREEOS includes a Windows helper that provisions SearXNG using the current official SearXNG Docker Compose template.

Prerequisite: Docker Desktop with the Docker engine running.

From the FREEOS repository root:

```powershell
npm.cmd run setup:searxng
```

The helper:

- checks that Docker and Docker Compose v2 are available
- downloads the current official SearXNG Compose template
- binds SearXNG to `127.0.0.1:8080` only
- creates a private random SearXNG secret
- enables the JSON search format required by FREEOS
- starts SearXNG and Valkey
- verifies `/search?q=freeos&format=json`
- updates the root FREEOS `.env` with `SEARXNG_BASE_URL=http://127.0.0.1:8080`

Runtime files live under `data/searxng/` and are not intended to be exposed publicly.

Verify after setup:

```powershell
npm.cmd run check:searxng
```

If the setup helper reports that Docker is missing, install/start Docker Desktop first and rerun the command. If the containers start but the JSON health check does not pass, inspect them with:

```powershell
cd E:\FREEOS\data\searxng
docker compose ps
docker compose logs core --tail 100
```

## Other setup choices

1. Point FREEOS at an existing local or trusted network SearXNG instance.
2. Configure the URL of another SearXNG instance you self-host manually.

The SearXNG instance must allow JSON output (`format=json`). Requesting JSON when the instance has not enabled that format returns HTTP 403.

FREEOS still boots when SearXNG is unavailable. The research status displays **SearXNG offline / setup needed**, searches return a clean setup error, and memory, projects, Ollama discovery, and the rest of the dashboard continue working.

Do not place credentials in `SEARXNG_BASE_URL`. FREEOS does not log in, bypass paywalls, or crawl sites. Its page reader only fetches individual public HTML URLs with time and size limits.
