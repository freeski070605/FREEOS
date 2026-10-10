# SearXNG setup for FREEOS on Windows

SearXNG gives FREEOS live web search without a paid search API key. FREEOS expects it at `http://127.0.0.1:8080` by default and requests its JSON search endpoint.

Set a different local, network, or self-hosted instance in `.env`:

```env
SEARXNG_BASE_URL=http://127.0.0.1:8080
```

## Recommended local setup on Windows: WSL on E: (no Docker)

FREEOS uses a dedicated WSL 2 Linux distribution for SearXNG and places the Linux distribution storage under `E:\FREEOS_Linux` by default. Docker Desktop is not required.

From the FREEOS repository root:

```powershell
npm.cmd run setup:searxng
```

The helper:

- checks that WSL is enabled and recent enough to support `--location`
- refuses to silently install a Linux distribution on C:
- selects an unused Ubuntu or Debian distribution
- installs that distribution directly under `E:\FREEOS_Linux\<distro>`
- installs SearXNG from its official Git repository into `/opt/freeos-searxng`
- creates a dedicated `searxng` Linux user and Python virtual environment
- enables SearXNG JSON output required by FREEOS
- binds SearXNG to `127.0.0.1:8080` inside WSL
- starts the service and verifies the JSON search endpoint from Windows
- records the selected WSL distribution and SearXNG URL in the root `.env`

If WSL is not enabled yet, the helper stops rather than installing a distribution to the wrong location. Open an Administrator PowerShell once and run:

```powershell
wsl.exe --install --no-distribution --web-download
```

Restart Windows if requested, return to `E:\FREEOS`, and rerun:

```powershell
npm.cmd run setup:searxng
```

Microsoft WSL supports installing distributions to a chosen folder with `--location`. FREEOS intentionally requires that capability for this setup so the dedicated Linux filesystem stays off C:.

SearXNG's direct Linux installation uses its official source tree and a Python virtual environment. FREEOS runs the local web application directly for this private workstation use instead of installing Docker Desktop.

## Starting it later

After setup, start the WSL-hosted SearXNG service with:

```powershell
npm.cmd run start:searxng
```

Then verify:

```powershell
npm.cmd run check:searxng
```

Expected status:

```text
[FREEOS] SearXNG online: http://127.0.0.1:8080
```

If startup fails, inspect the Linux log using the distro name saved in `.env` as `SEARXNG_WSL_DISTRO`:

```powershell
wsl.exe -d <distro> -u root -- bash -lc "tail -n 120 /opt/freeos-searxng/searxng.log"
```

## Optional Docker path

The older Docker helper remains available only as an explicit alternative:

```powershell
npm.cmd run setup:searxng:docker
```

It is not the default FREEOS setup.

## Other setup choices

1. Point FREEOS at an existing local or trusted network SearXNG instance.
2. Configure the URL of another SearXNG instance you self-host manually.

The SearXNG instance must allow JSON output (`format=json`). Requesting JSON when the instance has not enabled that format returns HTTP 403.

FREEOS still boots when SearXNG is unavailable. The research status displays **SearXNG offline / setup needed**, searches return a clean setup error, and memory, projects, Ollama discovery, and the rest of the dashboard continue working.

Do not place credentials in `SEARXNG_BASE_URL`. FREEOS does not log in, bypass paywalls, or crawl sites. Its page reader only fetches individual public HTML URLs with time and size limits.
