import { createRequire } from "node:module";
import { resolve } from "node:path";
import process from "node:process";

const require = createRequire(import.meta.url);
const { comfyStatus, validateLocalComfyEndpoint } = require(resolve(process.cwd(), "packages/animation-core/dist/index.js"));

const endpointArg = process.argv.slice(2).find(value => value.startsWith("--endpoint="));
const endpoint = endpointArg?.slice("--endpoint=".length) || process.env.FREEOS_COMFYUI_URL;

try {
  const local = validateLocalComfyEndpoint(endpoint);
  const status = await comfyStatus(local);
  process.stdout.write(JSON.stringify(status, null, 2) + "\n");
  if (!status.available) process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(2);
}
