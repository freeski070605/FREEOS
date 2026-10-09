import { Router } from "express";
import { lstat, realpath } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  captureScreen,
  getActiveWindow,
  getComputerStatus,
  listProcesses,
  listWindows,
} from "@freeos/computer-core";

export const computerRouter = Router();

const freeosRoot = resolve(__dirname, "../../../..");
const screenshotRoot = resolve(freeosRoot, "generated", "computer", "screenshots");
const screenshotName = /^freeos-screen-\d{13}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.png$/;

computerRouter.get("/status", async (_request, response, next) => {
  try { response.json(await getComputerStatus()); } catch (error) { next(error); }
});
computerRouter.get("/windows", async (_request, response, next) => {
  try { response.json(await listWindows()); } catch (error) { next(error); }
});
computerRouter.get("/active-window", async (_request, response, next) => {
  try { response.json(await getActiveWindow()); } catch (error) { next(error); }
});
computerRouter.get("/processes", async (_request, response, next) => {
  try { response.json(await listProcesses()); } catch (error) { next(error); }
});

computerRouter.post("/snapshot", async (_request, response, next) => {
  try {
    const snapshot = await captureScreen(freeosRoot);
    const filename = snapshot.relativePath.split("/").at(-1);
    if (!filename || !screenshotName.test(filename)) throw new Error("FREEOS generated an invalid screenshot filename.");
    response.json({ snapshot: { ...snapshot, url: `/computer/screenshots/${filename}` } });
  } catch (error) { next(error); }
});

computerRouter.get("/screenshots/:filename", async (request, response, next) => {
  const filename = request.params.filename;
  if (!screenshotName.test(filename)) {
    response.status(400).json({ error: "Invalid screenshot filename." });
    return;
  }
  try {
    const canonicalRoot = await realpath(screenshotRoot);
    const canonicalFile = await realpath(resolve(canonicalRoot, filename));
    const info = await lstat(canonicalFile);
    if (dirname(canonicalFile).toLowerCase() !== canonicalRoot.toLowerCase() || !info.isFile() || info.isSymbolicLink()) {
      response.status(404).json({ error: "Screenshot not found." });
      return;
    }
    response.setHeader("Cache-Control", "no-store, max-age=0");
    response.type("png");
    response.sendFile(canonicalFile, error => { if (error) next(error); });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      response.status(404).json({ error: "Screenshot not found." });
      return;
    }
    next(error);
  }
});
