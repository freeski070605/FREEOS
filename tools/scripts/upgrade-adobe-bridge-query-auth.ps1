$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$workerPath = Join-Path $repoRoot "apps\adobe-worker\src\index.ts"
$premierePath = Join-Path $repoRoot "adobe\premiere-uxp\index.js"
$afterEffectsPath = Join-Path $repoRoot "adobe\after-effects-uxp\index.js"

function Replace-Exact {
    param(
        [Parameter(Mandatory=$true)][string]$Path,
        [Parameter(Mandatory=$true)][string]$Old,
        [Parameter(Mandatory=$true)][string]$New,
        [Parameter(Mandatory=$true)][string]$AlreadyPresent,
        [Parameter(Mandatory=$true)][string]$Label
    )

    $text = [System.IO.File]::ReadAllText($Path)

    if ($text.Contains($AlreadyPresent)) {
        Write-Host "$Label already upgraded." -ForegroundColor DarkGray
        return
    }

    if (-not $text.Contains($Old)) {
        throw "${Label}: expected source fragment was not found. Refusing blind patch."
    }

    $updated = $text.Replace($Old, $New)
    [System.IO.File]::WriteAllText($Path, $updated, [System.Text.UTF8Encoding]::new($false))
    Write-Host "$Label upgraded." -ForegroundColor Green
}

$workerOld = @'
const bridgeWss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024, handleProtocols: protocols => protocols.has("freeos-v1") ? "freeos-v1" : false });
bridgeServer.on("upgrade", (request, socket, head) => {
  const protocols = (request.headers["sec-websocket-protocol"] || "").split(",").map(value => value.trim());
  const supplied = Buffer.from(protocols[1] || ""); const expected = Buffer.from(bridgeToken);
  if (request.url !== "/adobe/bridge" || protocols[0] !== "freeos-v1" || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) { socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n"); socket.destroy(); return; }
  bridgeWss.handleUpgrade(request, socket, head, ws => wire(ws, true));
});
'@

$workerNew = @'
const bridgeWss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024, handleProtocols: protocols => protocols.has("freeos-v1") ? "freeos-v1" : false });
bridgeServer.on("upgrade", (request, socket, head) => {
  let requestUrl: URL;
  try { requestUrl = new URL(request.url || "/", "http://127.0.0.1"); }
  catch { socket.write("HTTP/1.1 400 Bad Request\r\n\r\n"); socket.destroy(); return; }
  const protocols = (request.headers["sec-websocket-protocol"] || "").split(",").map(value => value.trim()).filter(Boolean);
  const supplied = Buffer.from(requestUrl.searchParams.get("token") || ""); const expected = Buffer.from(bridgeToken);
  const validToken = supplied.length === expected.length && supplied.length > 0 && timingSafeEqual(supplied, expected);
  if (requestUrl.pathname !== "/adobe/bridge" || !protocols.includes("freeos-v1") || !validToken) { socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n"); socket.destroy(); return; }
  bridgeWss.handleUpgrade(request, socket, head, ws => wire(ws, true));
});
'@

Replace-Exact `
    -Path $workerPath `
    -Old $workerOld `
    -New $workerNew `
    -AlreadyPresent 'requestUrl.searchParams.get("token")' `
    -Label "Adobe worker bridge auth"

$uxpOld = 'socket = new WebSocket("ws://127.0.0.1:4319/adobe/bridge", ["freeos-v1", secret]);'
$uxpNew = 'socket = new WebSocket("ws://127.0.0.1:4319/adobe/bridge?token=" + encodeURIComponent(secret), ["freeos-v1"]);'

Replace-Exact `
    -Path $premierePath `
    -Old $uxpOld `
    -New $uxpNew `
    -AlreadyPresent 'adobe/bridge?token=' `
    -Label "Premiere UXP bridge client"

Replace-Exact `
    -Path $afterEffectsPath `
    -Old $uxpOld `
    -New $uxpNew `
    -AlreadyPresent 'adobe/bridge?token=' `
    -Label "After Effects UXP bridge client"

Write-Host "`nBridge auth upgrade complete." -ForegroundColor Cyan
Write-Host "Next: build the Adobe worker, restart it, reload UXP plugins, and reconnect." -ForegroundColor Cyan
