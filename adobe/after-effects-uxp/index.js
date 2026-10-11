const { entrypoints, host } = require("uxp");
const app = require("aftereffects");
let socket; let secret = ""; let retry;
const status = value => { const element = document.getElementById("status"); if (element) element.textContent = value; };
const actions = {
  "project.inspect": async () => ({ activeItem: app.project.activeItem && { id: app.project.activeItem.id, name: app.project.activeItem.name }, items: Array.from({ length: app.project.numItems }, (_, i) => { const item = app.project.item(i + 1); return { id: item.id, name: item.name, type: item.typeName }; }) }),
  "project.open": async command => { if (typeof command.args.path !== "string") throw new Error("Path required."); const project = app.open(command.args.path); return { opened: !!project, items: project ? project.numItems : 0 }; },
  "project.save": async () => ({ saved: app.project.save() }),
  "project.saveas": async command => { if (typeof command.args.path !== "string") throw new Error("Path required."); return { saved: app.project.save(command.args.path) }; },
  "composition.inspect": async () => { const item = app.project.activeItem; if (!item || !item.layers) throw new Error("Select a composition."); return { id: item.id, name: item.name, duration: item.duration, frameRate: item.frameRate, width: item.width, height: item.height, layers: Array.from({ length: item.numLayers }, (_, i) => { const layer = item.layer(i + 1); return { id: layer.id, name: layer.name, inPoint: layer.inPoint, outPoint: layer.outPoint, enabled: layer.enabled }; }) }; },
  "composition.duplicate": async command => { const item = app.project.activeItem; if (!item || !item.layers) throw new Error("Select a composition."); if (typeof command.args.name !== "string" || !command.args.name.startsWith("FREEOS_")) throw new Error("FREEOS composition name required."); const copy = item.duplicate(); copy.name = command.args.name; return { id: copy.id, name: copy.name, sourceId: item.id }; },
};
function connect() {
  if (!secret || (socket && [WebSocket.CONNECTING, WebSocket.OPEN].includes(socket.readyState))) return;
  socket = new WebSocket("ws://127.0.0.1:4319/adobe/bridge", ["freeos-v1", secret]);
  socket.onopen = () => { status("Connected to local worker"); socket.send(JSON.stringify({ type: "bridge-register", application: "after-effects", capabilities: Object.keys(actions).map(action => ({ application: "after-effects", action, method: "native", available: true, version: host.version })) })); };
  socket.onmessage = async event => { let command; try { const message = JSON.parse(event.data); if (message.type !== "bridge-command" || message.command.application !== "after-effects") return; command = message.command; if (!actions[command.action]) throw new Error("Action unavailable in After Effects bridge."); const output = await actions[command.action](command); socket.send(JSON.stringify({ type: "bridge-result", result: { id: command.id, jobId: command.id, state: "complete", method: "native", output, progress: 1, timestamp: new Date().toISOString() } })); } catch (error) { if (command && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "bridge-result", result: { id: command.id, jobId: command.id, state: "failed", method: "native", error: String(error), progress: 0, timestamp: new Date().toISOString() } })); } };
  socket.onclose = () => { status("Disconnected; retrying"); clearTimeout(retry); retry = setTimeout(connect, 5000); };
  socket.onerror = () => status("Connection failed");
}
entrypoints.setup({ panels: { freeosBridge: { show() { document.getElementById("connect").onclick = () => { secret = document.getElementById("token").value.trim(); connect(); }; } } } });
