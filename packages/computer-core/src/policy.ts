import { win32 } from "node:path";

export class ComputerError extends Error {
  constructor(message: string, readonly code: "blocked" | "validation" | "unavailable") { super(message); this.name = "ComputerError"; }
}

// Central emergency-stop seam. Read at execution time, never cache this decision.
export function isComputerControlAllowed(): boolean { return process.env.COMPUTER_CONTROL_ENABLED === "true"; }
export function isScreenCaptureAllowed(): boolean { return process.env.COMPUTER_SCREEN_CAPTURE_ENABLED === "true"; }
export function assertComputerControlAllowed(): void {
  if (!isComputerControlAllowed()) throw new ComputerError("Computer control is locked (COMPUTER_CONTROL_ENABLED=false).", "blocked");
}
export function assertScreenCaptureAllowed(): void {
  if (!isScreenCaptureAllowed()) throw new ComputerError("Screen capture is locked (COMPUTER_SCREEN_CAPTURE_ENABLED=false).", "blocked");
}

export const CONTROL_KEYS = ["computer.window.focus", "computer.mouse.move", "computer.mouse.click", "computer.keyboard.type", "computer.keyboard.press", "computer.keyboard.hotkey", "computer.app.launch"] as const;
export const OBSERVATION_KEYS = ["computer.status", "computer.windows.list", "computer.window.active", "computer.processes.list", "computer.screen.capture"] as const;
export const ALLOWED_KEYS = ["Tab", "Escape", "Left", "Right", "Up", "Down", "Home", "End", "PageUp", "PageDown", "Backspace", "Space"] as const;
// Paste can contain unreviewed clipboard data, so it is excluded.
export const ALLOWED_HOTKEYS = ["CTRL+A", "CTRL+C", "CTRL+Z", "CTRL+Y", "CTRL+F", "SHIFT+TAB"] as const;
export type ComputerArgs = Record<string, unknown>;

export function validateComputerArgs(key: string, input: ComputerArgs): ComputerArgs {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new ComputerError("Arguments must be an object.", "validation");
  const fields: Record<string, string[]> = {
    "computer.status": [], "computer.windows.list": [], "computer.window.active": [], "computer.processes.list": [], "computer.screen.capture": [],
    "computer.window.focus": ["processId"], "computer.mouse.move": ["processId", "x", "y"], "computer.mouse.click": ["processId", "x", "y", "button"],
    "computer.keyboard.type": ["processId", "text"], "computer.keyboard.press": ["processId", "key"], "computer.keyboard.hotkey": ["processId", "hotkey"], "computer.app.launch": ["executable", "args"],
  };
  if (!fields[key]) throw new ComputerError("Unknown computer capability.", "blocked");
  if (Object.keys(input).some(field => !fields[key].includes(field))) throw new ComputerError("Unexpected computer argument; secrets and scripts are not accepted.", "validation");
  if (fields[key].includes("processId") && (!Number.isSafeInteger(input.processId) || Number(input.processId) <= 0)) throw new ComputerError("A positive target processId is required.", "validation");
  for (const coord of ["x", "y"]) if (fields[key].includes(coord) && !Number.isSafeInteger(input[coord])) throw new ComputerError("Coordinates must be integers.", "validation");
  if (key === "computer.mouse.click" && !["left", "right", "double"].includes(String(input.button))) throw new ComputerError("button must be left, right, or double.", "validation");
  if (key === "computer.keyboard.type") {
    if (typeof input.text !== "string" || input.text.length < 1 || input.text.length > 4000 || /[\x00-\x1f\x7f]/.test(input.text)) throw new ComputerError("Text must contain 1–4000 printable characters, without control characters.", "validation");
    if (/(?:password|passwd|secret|token|api[_ -]?key)\s*[:=]|-----BEGIN .*PRIVATE KEY|\b(?:sk|ghp|github_pat)[_-][A-Za-z0-9_-]{16,}/i.test(input.text)) throw new ComputerError("Credential-like text is not accepted. Never submit secrets to computer tools.", "blocked");
  }
  if (key === "computer.keyboard.press" && !(ALLOWED_KEYS as readonly unknown[]).includes(input.key)) throw new ComputerError("Key is not allowed.", "blocked");
  if (key === "computer.keyboard.hotkey" && !(ALLOWED_HOTKEYS as readonly unknown[]).includes(input.hotkey)) throw new ComputerError("Hotkey is not allowed.", "blocked");
  if (key === "computer.app.launch") {
    const executable = input.executable;
    const windows = process.env.SystemRoot || "C:\\Windows";
    const allowed = [win32.join(windows, "System32", "notepad.exe"), win32.join(windows, "System32", "calc.exe"), win32.join(windows, "System32", "mspaint.exe")];
    if (typeof executable !== "string" || !allowed.some(path => path.toLowerCase() === executable.toLowerCase())) throw new ComputerError("Launch requires an exact Windows System32 path to notepad.exe, calc.exe, or mspaint.exe. Other executables and all script hosts are blocked.", "blocked");
    if (!Array.isArray(input.args) || input.args.length !== 0) throw new ComputerError("This foundation only allows an explicit empty args array.", "blocked");
  }
  return { ...input };
}

// Text remains available only in the approval payload; audit runs never duplicate it.
export function computerAuditArgs(key: string, args: ComputerArgs): ComputerArgs {
  return key === "computer.keyboard.type" ? { processId: args.processId, text: "[redacted]", characterCount: typeof args.text === "string" ? args.text.length : 0 } : args;
}

export function computerAuditOutput(key: string, output: unknown): unknown {
  if (!key.startsWith("computer.")) return output;
  // Window captions can contain document text or account information. Show them
  // to the requesting UI, but do not persist them as a second copy in the audit.
  const redact = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(redact);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([field, item]) => [field, field === "windowTitle" || field === "mainWindowTitle" ? "[omitted from audit]" : redact(item)]));
    return value;
  };
  return redact(output);
}
