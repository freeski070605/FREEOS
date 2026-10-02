import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { getComputerStatus } from "@freeos/computer-core";

dotenv.config({ path: fileURLToPath(new URL("../../.env", import.meta.url)), quiet: true });
const status = await getComputerStatus();
console.log(JSON.stringify(status, null, 2));
if (status.supported && !status.observationAvailable) process.exitCode = 1;
