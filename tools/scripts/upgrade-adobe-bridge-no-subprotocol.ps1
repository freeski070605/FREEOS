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
  const protocols = (request.headers["sec-websocket-protocol"] || "").split(",").map(value => value.trim()).filter(Boolean);
  if (request.url !== "/adobe/bridge" || !protocols.includes("freeos-v1")) { socket.write("HTTP/1.1 400 Bad Request\r\n\r\n"); socket.destroy(); return; }
  bridgeWss.handleUpgrade(request, socket, head, ws => wire(ws, true));
});
'@

$workerNew = @'
const bridgeWss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });
bridgeServer.on("upgrade", (request, socket, head) => {
  if (request.url !== "/adobe/bridge") { socket.write("HTTP/1.1 400 Bad Request\r\n\r\n"); socket.destroy(); return; }
  bridgeWss.handleUpgrade(request, socket, head, ws => wire(ws, true));
});
'@

Replace-Exact `
    -Path $workerPath `
    -Old $workerOld `
    -New $workerNew `
    -AlreadyPresent 'const bridgeWss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });' `
    -Label "Adobe worker no-subprotocol handshake"

$uxpOld = 'socket = new WebSocket("ws://127.0.0.1:4319/adobe/bridge", ["freeos-v1"]);'
$uxpNew = 'socket = new WebSocket("ws://127.0.0.1:4319/adobe/bridge");'

Replace-Exact `
    -Path $premierePath `
    -Old $uxpOld `
    -New $uxpNew `
    -AlreadyPresent 'new WebSocket("ws://127.0.0.1:4319/adobe/bridge");' `
    -Label "Premiere UXP no-subprotocol client"

Replace-Exact `
    -Path $afterEffectsPath `
    -Old $uxpOld `
    -New $uxpNew `
    -AlreadyPresent 'new WebSocket("ws://127.0.0.1:4319/adobe/bridge");' `
    -Label "After Effects UXP no-subprotocol client"

Write-Host "`nNo-subprotocol Adobe bridge upgrade complete." -ForegroundColor Cyan
Write-Host "The token is still validated in the first bridge-register message." -ForegroundColor Cyan
