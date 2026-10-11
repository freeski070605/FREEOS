# Blakeo test 001

The project file on `Freeski-AIO` (`192.168.1.152`) is `D:\Freeski\adobe\Blakeo-EndOfSummer.prproj`. A read-only inspection of its saved Premiere XML found one sequence named `0M6A3868`, five video track items (four tracks muted), and one music track item. Treat this as a snapshot; verify the current state in Premiere before making changes. Preserve the existing alignment and do not reimport or resync footage.

Start the worker and Premiere bridge, inspect `premiere.project.inspect`, then inspect `premiere.sequence.inspect`. Verify the live project path, media status, timeline item identities, and alignment. The worker backs up the project file before dispatching `premiere.sequence.clone`. Clone the verified sequence as `BLAKEO_FREEOS_PASS_01` and confirm that the source remains intact. Subsequent edit, grade, render, and review application still needs execution adapters and live Adobe validation before a finished video can be claimed.

On the laptop, after the AIO worker and Premiere bridge are online:

```powershell
cd E:\FREEOS
npm run adobe:status
$job = Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:3001/adobe/jobs' -ContentType 'application/json' -Body '{"application":"premiere","action":"project.inspect","args":{}}'
Invoke-RestMethod -Uri "http://127.0.0.1:3001/adobe/jobs/$($job.jobId)"
```

Use the same request shape for `sequence.inspect`. After reviewing its tracks and clips, submit the clone with `projectPath` set to the exact `path` returned by `project.inspect`:

```powershell
$body = @{ application = 'premiere'; action = 'sequence.clone'; args = @{ name = 'BLAKEO_FREEOS_PASS_01'; projectPath = 'D:\Freeski\adobe\Blakeo-EndOfSummer.prproj' } } | ConvertTo-Json -Depth 5
$job = Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:3001/adobe/jobs' -ContentType 'application/json' -Body $body
Invoke-RestMethod -Uri "http://127.0.0.1:3001/adobe/jobs/$($job.jobId)"
```

Jobs are asynchronous; poll until `state` is `complete` or `failed`.
