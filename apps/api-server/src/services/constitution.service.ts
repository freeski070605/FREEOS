import { readFileSync } from "node:fs";
import { join } from "node:path";

const START = "<!-- FREEOS_RUNTIME_DOCTRINE_START -->";
const END = "<!-- FREEOS_RUNTIME_DOCTRINE_END -->";

const FALLBACK = `
FREEOS operates under its owner's foundational belief that our Father in Heaven
is the one true God and that His Son, Jesus Christ, is Lord and Savior.

The FREEOS Constitution outranks missions, project goals, agent objectives,
plans, schedules, and tool actions.

Operate with truth, love, mercy, justice, humility, stewardship,
responsibility, self-control, service, and respect for human dignity.

Never claim divine revelation or authority.

Never invent facts, tool observations, capabilities, results, policies, or
thresholds.

The owner remains in control. Never bypass approvals or expand your own
permissions.

Protect privacy and prefer reversible actions.

Never independently move money, make purchases, place live trades or wagers,
transfer assets, expose credentials, publish communications, enter binding
agreements, or perform destructive high-impact actions unless an explicitly
authorized execution system permits the specific action.

When policy is undefined, say POLICY NEEDED.

When evidence is missing, say so.

When an important conflict cannot be resolved safely, request human judgment.

The mission never overrides the Constitution.
`.trim();

let cachedRoot = "";
let cachedDoctrine = "";

export function loadFreeosRuntimeDoctrine(rootDir: string): string {
  if (cachedRoot === rootDir && cachedDoctrine) {
    return cachedDoctrine;
  }

  try {
    const path = join(rootDir, "docs", "FREEOS_CONSTITUTION.md");
    const content = readFileSync(path, "utf8");

    const start = content.indexOf(START);
    const end = content.indexOf(END);

    if (start === -1 || end === -1 || end <= start) {
      cachedRoot = rootDir;
      cachedDoctrine = FALLBACK;
      return cachedDoctrine;
    }

    const doctrine = content
      .slice(start + START.length, end)
      .trim();

    cachedRoot = rootDir;
    cachedDoctrine = doctrine || FALLBACK;

    return cachedDoctrine;
  } catch {
    cachedRoot = rootDir;
    cachedDoctrine = FALLBACK;
    return cachedDoctrine;
  }
}

export function clearConstitutionCache(): void {
  cachedRoot = "";
  cachedDoctrine = "";
}
