const { entrypoints, host } = require("uxp");
const premiere = require("premierepro");
let socket;
let retry;
let secret = "";
const status = value => { const element = document.getElementById("status"); if (element) element.textContent = value; };
const capability = (action, available) => ({ application: "premiere", action, method: available ? "native" : "unavailable", available, version: host.version });
async function activeProject() { const project = await premiere.Project.getActiveProject(); if (!project) throw new Error("No active Premiere project."); return project; }
async function inspectProject() {
  const project = await activeProject(); const sequences = await project.getSequences(); const active = await project.getActiveSequence();
  return { id: project.guid, name: project.name, path: project.path, activeSequenceId: active && active.guid, sequences: sequences.map(sequence => ({ id: sequence.guid, name: sequence.name })) };
}
async function projectItems() {
  const root = await (await activeProject()).getRootItem(); const queue = [{ folder: root, parentId: null }]; const output = [];
  while (queue.length) {
    const current = queue.shift(); const items = await current.folder.getItems();
    for (const item of items) {
      if (output.length >= 10000) throw new Error("Project item traversal exceeded limit.");
      const entry = { id: item.getId(), parentId: current.parentId, name: item.name, type: item.type };
      try { const clip = premiere.ClipProjectItem.cast(item); entry.mediaPath = await clip.getMediaFilePath(); entry.offline = await clip.isOffline(); } catch { /* non-clip item */ }
      output.push(entry);
      try { const folder = premiere.FolderItem.cast(item); if (folder && typeof folder.getItems === "function") queue.push({ folder, parentId: entry.id }); } catch { /* non-folder item */ }
    }
  }
  return output;
}
async function inspectSequence() {
  const project = await activeProject(); const sequence = await project.getActiveSequence(); if (!sequence) throw new Error("No active sequence.");
  const tracks = [];
  for (const kind of ["video", "audio"]) {
    const count = kind === "video" ? await sequence.getVideoTrackCount() : await sequence.getAudioTrackCount();
    for (let index = 0; index < count; index++) {
      const track = kind === "video" ? await sequence.getVideoTrack(index) : await sequence.getAudioTrack(index);
      const items = track.getTrackItems(premiere.Constants.TrackItemType.CLIP, false);
      tracks.push({ kind, index, id: track.id, name: track.name, muted: await track.isMuted(), clips: await Promise.all(items.map(async item => ({ id: (await item.getProjectItem()).getId(), name: await item.getName(), start: (await item.getStartTime()).seconds, end: (await item.getEndTime()).seconds, sourceIn: (await item.getInPoint()).seconds, sourceOut: (await item.getOutPoint()).seconds }))) });
    }
  }
  return { id: sequence.guid, name: sequence.name, timebase: await sequence.getTimebase(), end: (await sequence.getEndTime()).seconds, playhead: (await sequence.getPlayerPosition()).seconds, tracks };
}
async function cloneSequence(command) {
  const project = await activeProject(); const active = await project.getActiveSequence();
  if (!active) throw new Error("No active sequence.");
  if (project.path !== command.args.projectPath) throw new Error("Project path changed since backup; clone refused.");
  if (command.args.sourceId && active.guid !== command.args.sourceId) throw new Error("Active sequence does not match sourceId.");
  const name = command.args.name;
  if (typeof name !== "string" || !/^BLAKEO_FREEOS_(PASS_\d{2}|FINAL)$/.test(name)) throw new Error("Working sequence must use the FREEOS Blakeo naming convention.");
  if ((await project.getSequences()).some(item => item.name === name)) throw new Error("Working sequence name already exists.");
  const before = new Set((await project.getSequences()).map(item => item.guid));
  const ok = project.executeTransaction(compound => compound.addAction(active.createCloneAction()), "FREEOS duplicate working sequence");
  if (!ok) throw new Error("Premiere declined the sequence clone.");
  const after = await project.getSequences(); const clone = after.find(item => !before.has(item.guid));
  if (!clone) throw new Error("Clone action completed but no new sequence was found.");
  const item = await clone.getProjectItem();
  if (!project.executeTransaction(compound => compound.addAction(item.createSetNameAction(name)), "FREEOS name working sequence")) throw new Error("Premiere declined the sequence rename.");
  await project.setActiveSequence(clone);
  return { id: clone.guid, name, sourceId: active.guid };
}
async function sequenceMarkers() {
  const sequence = await (await activeProject()).getActiveSequence(); if (!sequence) throw new Error("No active sequence.");
  const markers = await premiere.Markers.getMarkers(sequence);
  return markers.getMarkers([]).map(marker => ({ id: marker.guid || null, name: marker.getName(), type: marker.getType(), start: marker.getStart().seconds, duration: marker.getDuration().seconds, comments: marker.getComments(), colorIndex: marker.getColorIndex() }));
}
async function sequenceSettings() {
  const sequence = await (await activeProject()).getActiveSequence(); if (!sequence) throw new Error("No active sequence.");
  const settings = await sequence.getSettings();
  return { frameRect: await settings.getVideoFrameRect(), pixelAspectRatio: await settings.getVideoPixelAspectRatio(), audioChannels: await settings.getAudioChannelCount(), editingMode: await settings.getEditingMode() };
}
const actions = {
  "project.inspect": inspectProject,
  "project.items": projectItems,
  "project.open": async command => { if (typeof command.args.path !== "string") throw new Error("Path required."); const project = await premiere.Project.open(command.args.path); return { id: project.guid, name: project.name, path: project.path }; },
  "project.save": async () => ({ saved: await (await activeProject()).save() }),
  "project.saveas": async command => { if (typeof command.args.path !== "string") throw new Error("Path required."); return { saved: await (await activeProject()).saveAs(command.args.path) }; },
  "sequence.inspect": inspectSequence,
  "sequence.markers": sequenceMarkers,
  "sequence.settings": sequenceSettings,
  "sequence.clone": cloneSequence,
};
function connect() {
  if (!secret) return;
  if (socket && [WebSocket.CONNECTING, WebSocket.OPEN].includes(socket.readyState)) return;
  socket = new WebSocket("ws://127.0.0.1:4319/adobe/bridge", ["freeos-v1", secret]);
  socket.onopen = () => { status("Connected to local worker"); socket.send(JSON.stringify({ type: "bridge-register", application: "premiere", capabilities: Object.keys(actions).map(action => capability(action, true)) })); };
  socket.onmessage = async event => {
    let command;
    try {
      const message = JSON.parse(event.data); if (message.type !== "bridge-command" || message.command.application !== "premiere") return;
      command = message.command; const action = actions[command.action]; if (!action) throw new Error("Action unavailable in Premiere bridge.");
      if (!["project.inspect", "project.items", "project.open", "sequence.inspect", "sequence.markers", "sequence.settings", "sequence.clone", "project.save", "project.saveas"].includes(command.action)) { const sequence = await (await activeProject()).getActiveSequence(); if (sequence && sequence.name.toUpperCase().includes("MASTER_SYNC")) throw new Error("Refusing mutation on master sequence."); }
      const output = await action(command);
      socket.send(JSON.stringify({ type: "bridge-result", result: { id: command.id, jobId: command.id, state: "complete", method: "native", output, progress: 1, timestamp: new Date().toISOString() } }));
    } catch (error) { if (command && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "bridge-result", result: { id: command.id, jobId: command.id, state: "failed", method: "native", error: String(error), progress: 0, timestamp: new Date().toISOString() } })); }
  };
  socket.onclose = () => { status("Disconnected; retrying"); clearTimeout(retry); retry = setTimeout(connect, 5000); };
  socket.onerror = () => status("Connection failed");
}
entrypoints.setup({ panels: { freeosBridge: { show() { document.getElementById("connect").onclick = () => { secret = document.getElementById("token").value.trim(); connect(); }; } } } });
