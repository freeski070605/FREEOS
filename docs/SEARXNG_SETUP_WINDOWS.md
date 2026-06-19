# SearXNG setup for FREEOS on Windows

SearXNG gives FREEOS live web search without a paid search API key. FREEOS expects it at `http://127.0.0.1:8080` by default and requests its JSON search endpoint.

Set a different local, network, or self-hosted instance in `.env`:

```env
SEARXNG_BASE_URL=http://127.0.0.1:8080
```

## Setup choices

1. Point FREEOS at an existing local or trusted network SearXNG instance.
2. Install SearXNG through Docker later if you choose. Docker is optional and is not started or managed by FREEOS.
3. Configure the URL of a SearXNG instance you self-host manually.

The SearXNG instance must allow JSON output (`format=json`). Check it with:

```powershell
npm run check:searxng
```

FREEOS still boots when SearXNG is unavailable. The research status displays **SearXNG offline / setup needed**, searches return a clean setup error, and memory, projects, Ollama discovery, and the rest of the dashboard continue working.

Do not place credentials in `SEARXNG_BASE_URL`. FREEOS does not log in, bypass paywalls, or crawl sites. Its page reader only fetches individual public HTML URLs with time and size limits.
