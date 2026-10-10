import { getToolRegistry, ToolExecutor, ToolRequests } from "@freeos/tool-runner";

const registry = () => getToolRegistry();
const parseIds = (value: unknown): number[] => {
  try {
    const parsed = JSON.parse(String(value ?? "[]"));
    return Array.isArray(parsed) ? parsed.map(Number).filter(Number.isFinite) : [];
  } catch { return []; }
};

class RemoteOpsApprovalRunner {
  private timer: NodeJS.Timeout | null = null;
  private working = false;

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => { void this.tick(); }, 1_000);
    this.timer.unref?.();
    void this.tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async tick(): Promise<void> {
    if (this.working) return;
    this.working = true;
    try {
      const db = registry().database;
      const rows = db.prepare("SELECT id, approval_ids FROM remote_ops_tasks WHERE status='waiting_approval' ORDER BY id ASC").all() as Array<{ id: number; approval_ids: string }>;
      const requests = new ToolRequests(registry());
      const executor = new ToolExecutor(registry());

      for (const task of rows) {
        const ids = parseIds(task.approval_ids);
        if (!ids.length) continue;
        const items = ids.map(id => requests.get(id));
        if (items.some(item => item.requestedBy !== `remote-ops:${task.id}`)) continue;
        if (items.some(item => ["pending", "rejected", "blocked", "failed"].includes(item.status))) continue;

        for (const item of items.filter(item => item.status === "approved")) {
          db.prepare("UPDATE remote_ops_tasks SET current_step='Owner approved — executing governed operator action', updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='waiting_approval'").run(task.id);
          try {
            await executor.runApprovedToolRequest(item.id);
          } catch (error) {
            db.prepare("UPDATE remote_ops_tasks SET current_step='Approved operator action failed', error=?, updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='waiting_approval'")
              .run(error instanceof Error ? error.message.slice(0, 4000) : "Approved operator action failed.", task.id);
            break;
          }
        }
      }
    } finally {
      this.working = false;
    }
  }
}

export const remoteOpsApprovalRunner = new RemoteOpsApprovalRunner();
