# Troubleshooting

- Worker refuses start: ensure `FREEOS_ADOBE_ENABLED=true`, both tokens are at least 32 characters, and a LAN host has TLS certificate and key paths.
- Laptop offline: confirm private address, port 4318, certificate trust, matching worker token, and Windows firewall source restriction. Check `npm run adobe:status` and the worker console.
- Native action unavailable: load the matching UXP plugin, open its panel, enter the separate bridge token, and inspect capabilities in the dashboard. A host older than the manifest minimum cannot load the plugin.
- Launch blocked: set `COMPUTER_CONTROL_ENABLED=true` on the AIO after configuring exact Adobe executable paths. The existing Computer Operator policy remains active.
- Capture blocked: set `COMPUTER_SCREEN_CAPTURE_ENABLED=true` on the AIO. Captures use the existing Computer Operator screenshot path and retention.
- Project path refused: configure semicolon-separated absolute project roots. Symlink or reparse targets outside those roots are refused.
- `ffprobe` unavailable: install FFmpeg on the AIO or set `FREEOS_FFMPEG_PATH` to the `ffmpeg.exe` beside `ffprobe.exe`.
