$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$workerPath = Join-Path $repoRoot "apps\adobe-worker\src\index.ts"
$premierePath = Join-Path $repoRoot "adobe\premiere-uxp\index.js"

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
        Write-Host "$Label already installed." -ForegroundColor DarkGray
        return
    }
    foreach ($old in $OldCandidates) {
        if ($text.Contains($old)) {
            $updated = $text.Replace($old, $New)
            [System.IO.File]::WriteAllText($Path, $updated, [System.Text.UTF8Encoding]::new($false))
            Write-Host "$Label installed." -ForegroundColor Green
            return
        }
    }
    throw "${Label}: expected source fragment was not found. Refusing blind patch."
}

# Worker: log every UXP upgrade attempt and tolerate a trailing slash.
$workerOld1 = @'
bridgeServer.on("upgrade", (request, socket, head) => {
  if (request.url !== "/adobe/bridge") { socket.write("HTTP/1.1 400 Bad Request\r\n\r\n"); socket.destroy(); return; }
  bridgeWss.handleUpgrade(request, socket, head, ws => wire(ws, true));
});
'@
$workerOld2 = @'
bridgeServer.on("upgrade", (request, socket, head) => {
  const protocols = (request.headers["sec-websocket-protocol"] || "").split(",").map(value => value.trim()).filter(Boolean);
  if (request.url !== "/adobe/bridge" || !protocols.includes("freeos-v1")) { socket.write("HTTP/1.1 400 Bad Request\r\n\r\n"); socket.destroy(); return; }
  bridgeWss.handleUpgrade(request, socket, head, ws => wire(ws, true));
});
'@
$workerNew = @'
bridgeServer.on("upgrade", (request, socket, head) => {
  const requestPath = String(request.url || "").split("?")[0];
  const acceptedPath = requestPath === "/adobe/bridge" || requestPath === "/adobe/bridge/";
  console.log(`[FREEOS Adobe] UXP websocket upgrade path=${request.url || "(empty)"} protocol=${request.headers["sec-websocket-protocol"] || "(none)"}`);
  if (!acceptedPath) {
    console.log(`[FREEOS Adobe] UXP websocket rejected: unexpected path ${requestPath}`);
    socket.write("HTTP/1.1 400 Bad Request\r\n\r\n"); socket.destroy(); return;
  }
  bridgeWss.handleUpgrade(request, socket, head, ws => {
    console.log("[FREEOS Adobe] UXP websocket upgraded");
    wire(ws, true);
  });
});
'@
Replace-OneOf -Path $workerPath -OldCandidates @($workerOld1, $workerOld2) -New $workerNew -AlreadyPresent 'UXP websocket upgrade path=' -Label "Worker websocket diagnostics"

# Premiere: expose constructor/open/error/close details directly in the panel status line.
$clientOldNoProto = @'
function connect() {
  if (!secret) return;
  if (socket && [WebSocket.CONNECTING, WebSocket.OPEN].includes(socket.readyState)) return;
  socket = new WebSocket("ws://127.0.0.1:4319/adobe/bridge");
  socket.onopen = () => { status("Connected to local worker"); socket.send(JSON.stringify({ type: "bridge-register", token: secret, application: "premiere", capabilities: Object.keys(actions).map(action => capability(action, true)) })); };
'@
$clientOldProto = @'
function connect() {
  if (!secret) return;
  if (socket && [WebSocket.CONNECTING, WebSocket.OPEN].includes(socket.readyState)) return;
  socket = new WebSocket("ws://127.0.0.1:4319/adobe/bridge", ["freeos-v1"]);
  socket.onopen = () => { status("Connected to local worker"); socket.send(JSON.stringify({ type: "bridge-register", token: secret, application: "premiere", capabilities: Object.keys(actions).map(action => capability(action, true)) })); };
'@
$clientNew = @'
function connect() {
  if (!secret) { status("No bridge token entered"); return; }
  if (socket && [WebSocket.CONNECTING, WebSocket.OPEN].includes(socket.readyState)) return;
  status("Opening ws://127.0.0.1:4319/adobe/bridge ...");
  try {
    socket = new WebSocket("ws://127.0.0.1:4319/adobe/bridge");
  } catch (error) {
    status(`WebSocket constructor failed: ${error && error.message ? error.message : String(error)}`);
    return;
  }
  socket.onopen = () => {
    status("Connected to local worker; authenticating...");
    socket.send(JSON.stringify({ type: "bridge-register", token: secret, application: "premiere", capabilities: Object.keys(actions).map(action => capability(action, true)) }));
  };
'@
Replace-OneOf -Path $premierePath -OldCandidates @($clientOldNoProto, $clientOldProto) -New $clientNew -AlreadyPresent 'WebSocket constructor failed:' -Label "Premiere websocket diagnostics"

# Replace the simple close/error callbacks while preserving the reconnect behavior.
$callbacksOld = @'
  socket.onclose = () => { status("Disconnected; retrying"); clearTimeout(retry); retry = setTimeout(connect, 5000); };
  socket.onerror = () => status("Connection failed");
'@
$callbacksNew = @'
  socket.onclose = event => {
    const code = event && event.code !== undefined ? event.code : "?";
    const reason = event && event.reason ? event.reason : "(none)";
    const clean = event && event.wasClean !== undefined ? event.wasClean : "?";
    status(`WS CLOSED code=${code} clean=${clean} reason=${reason}; retrying`);
    clearTimeout(retry); retry = setTimeout(connect, 5000);
  };
  socket.onerror = event => {
    const message = event && event.message ? event.message : String(event && event.type ? event.type : event || "unknown error");
    status(`WS ERROR: ${message}`);
  };
'@
Replace-OneOf -Path $premierePath -OldCandidates @($callbacksOld) -New $callbacksNew -AlreadyPresent 'WS CLOSED code=' -Label "Premiere close/error diagnostics"

Write-Host "`nAdobe UXP WebSocket diagnostics installed." -ForegroundColor Cyan
Write-Host "Build/restart worker, reload the Premiere plugin, click Connect once, then report BOTH the panel status and worker terminal line." -ForegroundColor Cyan
