# Local Windows Setup

## External drive layout

Use a stable drive letter when possible:

```powershell
J:
cd J:\FREEOS
```

Do not unplug the drive while FREEOS, SQLite, Ollama, or an editor is using it.

## Install and initialize

Install Node.js 20 or newer, then run:

```powershell
cd J:\FREEOS
npm install
npm run setup:folders
npm run init:memory
npm run dev
```

The SQLite database at `data/freeos.sqlite` and the default `data/projects/` folders are created automatically if missing. Initialization does not delete or overwrite user files.

Dashboard: <http://localhost:5173>  
API: <http://localhost:3001/health>

Useful checks:

```powershell
npm run check:ollama
npm run memory:status
.\tools\powershell\check-system.ps1
```

## Safe backups

Stop FREEOS, then copy both of these to backup storage:

- `data/freeos.sqlite`
- `data/projects/`

Keep them together to preserve memory metadata and project knowledge. Do not copy an actively changing database unless the SQLite `-wal` and `-shm` companion files are also handled correctly.

## PowerShell execution policy

If local scripts are blocked, use a process-only policy change:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\tools\powershell\start-dev.ps1
```

This expires when the PowerShell window closes. Do not weaken the machine-wide policy for FREEOS.

## Troubleshooting

- If port 3001 or 5173 is occupied, stop the conflicting process.
- If Ollama is disconnected, start Ollama and run `npm run check:ollama`.
- If memory setup is incomplete, run `npm run init:memory`; it is safe to repeat.
- If the external drive moved, use its current path and rerun initialization so folder checks resolve from the repository root.
- If native dependencies fail after changing Node versions or machines, reinstall dependencies with the supported Node 20+ runtime.
