const base = process.env.FREEOS_API_URL || "http://127.0.0.1:3001";
try {
  const response = await fetch(`${base}/command/status`, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const s = await response.json();
  console.log("FREEOS Command Center");
  console.log(`Phase: ${s.system.phase}`);
  console.log(`API: ${s.api.online ? "online" : "offline"}`);
  console.log(`Ollama: ${s.ollama.connected ? `connected (${s.ollama.defaultModel})` : "offline"}`);
  console.log(`Memory: ${s.memory.approvedMemories} approved, ${s.memory.pendingProposals} pending`);
  console.log(`Projects: ${s.projects.projectCount}; notes: ${s.projects.notesCount}`);
  console.log(`Research: ${s.research.searxngOnline ? "online" : "offline"}`);
  console.log(`Approvals: ${s.approvals.total} pending`);
  console.log(`Backups: ${s.backup.count}`);
  console.log("Safety: dangerous actions off; writes require approval; high-risk tools blocked");
} catch (error) {
  console.log("FREEOS Command Center API is not running.");
  console.log(`Expected: ${base}/command/status`);
  console.log("Local defaults: Phase 6, no paid API keys, dangerous actions off, writes require approval.");
  process.exitCode = 1;
}
