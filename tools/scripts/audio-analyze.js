import { createRequire } from "node:module";
import { resolve } from "node:path";
import process from "node:process";

const raw = process.argv.slice(2).join(" ").trim();
const target = raw.length >= 2 && ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'")))
  ? raw.slice(1, -1).trim()
  : raw;

if (!target) {
  console.error('Usage: npm run audio:analyze -- "C:\\path\\to\\song.mp3"');
  process.exit(2);
}

const require = createRequire(import.meta.url);
const { analyzeAudio } = require(resolve(process.cwd(), "packages/media-intelligence/dist/index.js"));

try {
  const result = await analyzeAudio(target);
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
