$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$workerPath = Join-Path $repoRoot "apps\adobe-worker\src\index.ts"
$premierePath = Join-Path $repoRoot "adobe\premiere-uxp\index.js"
$afterEffectsPath = Join-Path $repoRoot "adobe\after-effects-uxp\index.js"

function Replace-OneOf {
    param(
        [Parameter(Mandatory=$true)][string]$Path,
        [Parameter(Mandatory=$true)][string[]]$OldCandidates,
        [Parameter(Mandatory=$true)][string]$New,
        [Parameter(Mandatory=$true)][string]$AlreadyPresent,
        [Parameter(Mandatory=$true)][string]$Label
    )

    $text = [System.IO.File]::ReadAllText($Path)
    if ($text.Contains($AlreadyPresent)) {
        Write-Host "$Label already upgraded." -ForegroundColor DarkGray
        return
    }

    foreach ($old in $OldCandidates) {
        if ($text.Contains($old)) {
            $updated = $text.Replace($old, $New)
            [System.IO.File]::WriteAllText($Path, $updated, [System.Text.UTF8Encoding]::new($false))
            Write-Host "$Label upgraded." -ForegroundColor Green
            return
        }
    }

    throw "${Label}: expected source fragment was not found. Refusing blind patch."
}

$wireOld = @'
function wire(socket: WebSocket, isBridge: boolean): void {
  if (!isBridge) clients.add(socket);
  else socket.on("close", () => { for (const [app, current] of bridges) if (current === socket) bridges.delete(app); void broadcastRegistration(); });
  socket.on("message", async bytes => {
    let message: WireMessage;
    try { message = parseWireMessage(bytes.toString()); } catch { socket.close(1003, "Invalid message"); return; }
'@

$wireNew = @'
function wire(socket: WebSocket, isBridge: boolean): void {
  let bridgeAuthenticated = !isBridge;
  if (!isBridge) clients.add(socket);
  else socket.on("close", () => { for (const [app, current] of bridges) if (current === socket) bridges.delete(app); void broadcastRegistration(); });
  socket.on("message", async bytes => {
    const raw = bytes.toString();
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { socket.close(1003, "Invalid JSON"); return; }
    if (isBridge && !bridgeAuthenticated) {
      const authMessage = parsed as Record<string, unknown>;
      const supplied = Buffer.from(typeof authMessage.token === "string" ? authMessage.token : "");
      const expected = Buffer.from(bridgeToken);
      const validToken = supplied.length === expected.length && supplied.length > 0 && timingSafeEqual(supplied, expected);
      if (authMessage.type !== "bridge-register" || !validToken) { socket.close(1008, "Unauthorized bridge"); return; }
      bridgeAuthenticated = true;
    }
    let message: WireMessage;
    try { message = parseWireMessage(parsed); } catch { socket.close(1003, "Invalid message"); return; }
'@

Replace-OneOf `
    -Path $workerPath `
    -OldCandidates @($wireOld) `
    -New $wireNew `
    -AlreadyPresent 'let bridgeAuthenticated = !isBridge;' `
    -Label "Adobe worker bridge message auth"

$upgradeOld = @'
const bridgeWss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024, handleProtocols: protocols => protocols.has("freeos-v1") ? "freeos-v1" : false });
bridgeServer.on("upgrade", (request, socket, head) => {
  const protocols = (request.headers["sec-websocket-protocol"] || "").split(",").map(value => value.trim());
  const supplied = Buffer.from(protocols[1] || ""); const expected = Buffer.from(bridgeToken);
  if (request.url !== "/adobe/bridge" || protocols[0] !== "freeos-v1" || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) { socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n"); socket.destroy(); return; }
  bridgeWss.handleUpgrade(request, socket, head, ws => wire(ws, true));
});
'@

$upgradeQuery = @'
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

$upgradeNew = @'
const bridgeWss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024, handleProtocols: protocols => protocols.has("freeos-v1") ? "freeos-v1" : false });
bridgeServer.on("upgrade", (request, socket, head) => {
  const protocols = (request.headers["sec-websocket-protocol"] || "").split(",").map(value => value.trim()).filter(Boolean);
  if (request.url !== "/adobe/bridge" || !protocols.includes("freeos-v1")) { socket.write("HTTP/1.1 400 Bad Request\r\n\r\n"); socket.destroy(); return; }
  bridgeWss.handleUpgrade(request, socket, head, ws => wire(ws, true));
});
'@

Replace-OneOf `
    -Path $workerPath `
    -OldCandidates @($upgradeOld, $upgradeQuery) `
    -New $upgradeNew `
    -AlreadyPresent 'socket.close(1008, "Unauthorized bridge")' `
    -Label "Adobe worker bridge upgrade handshake"

$uxpOld = 'socket = new WebSocket("ws://127.0.0.1:4319/adobe/bridge", ["freeos-v1", secret]);'
$uxpQuery = 'socket = new WebSocket("ws://127.0.0.1:4319/adobe/bridge?token=" + encodeURIComponent(secret), ["freeos-v1"]);'
$uxpNew = 'socket = new WebSocket("ws://127.0.0.1:4319/adobe/bridge", ["freeos-v1"]);'

Replace-OneOf `
    -Path $premierePath `
    -OldCandidates @($uxpOld, $uxpQuery) `
    -New $uxpNew `
    -AlreadyPresent 'type: "bridge-register", token: secret, application: "premiere"' `
    -Label "Premiere UXP bridge socket"

Replace-OneOf `
    -Path $afterEffectsPath `
    -OldCandidates @($uxpOld, $uxpQuery) `
    -New $uxpNew `
    -AlreadyPresent 'type: "bridge-register", token: secret, application: "after-effects"' `
    -Label "After Effects UXP bridge socket"

$premOld = 'socket.send(JSON.stringify({ type: "bridge-register", application: "premiere", capabilities:'
$premNew = 'socket.send(JSON.stringify({ type: "bridge-register", token: secret, application: "premiere", capabilities:'
Replace-OneOf `
    -Path $premierePath `
    -OldCandidates @($premOld) `
    -New $premNew `
    -AlreadyPresent 'type: "bridge-register", token: secret, application: "premiere"' `
    -Label "Premiere UXP bridge registration token"

$aeOld = 'socket.send(JSON.stringify({ type: "bridge-register", application: "after-effects", capabilities:'
$aeNew = 'socket.send(JSON.stringify({ type: "bridge-register", token: secret, application: "after-effects", capabilities:'
Replace-OneOf `
    -Path $afterEffectsPath `
    -OldCandidates @($aeOld) `
    -New $aeNew `
    -AlreadyPresent 'type: "bridge-register", token: secret, application: "after-effects"' `
    -Label "After Effects UXP bridge registration token"

Write-Host "`nBridge message-auth upgrade complete." -ForegroundColor Cyan
Write-Host "Build/restart worker, then reload Premiere UXP and reconnect." -ForegroundColor Cyan
