# AIO setup

Install Node.js 20 or newer, clone the same FREEOS revision to the AIO, and run from PowerShell:

```powershell
cd D:\FREEOS
npm ci
powershell -NoProfile -ExecutionPolicy Bypass -File tools/scripts/setup-adobe-worker.ps1 -ProjectRoot 'D:\Freeski\adobe' -MediaRoot 'D:\Freeski\vids;E:\DCIM\102EOS5D;C:\Users\frees\Downloads' -BindAddress '192.168.1.152'
```

The script detects Adobe executable paths and generates independent random worker and bridge tokens in the untracked `.env`. Review those paths. The project file is `D:\Freeski\adobe\Blakeo-EndOfSummer.prproj`. Its saved media references include `E:\DCIM\102EOS5D` and `C:\Users\frees\Downloads`; the media roots above also include `D:\Freeski\vids` for the AIO footage library. Remove any root that is not needed after live media inspection. If OpenSSL is available, create a private LAN TLS certificate:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools/scripts/create-adobe-worker-cert.ps1 -DnsName 'Freeski-AIO' -IpAddress '192.168.1.152'
```

The certificate script adds `FREEOS_ADOBE_TLS_CERT` and `FREEOS_ADOBE_TLS_KEY` to the AIO `.env`. Keep the key on the AIO. Copy only `generated/adobe-worker/tls/worker-cert.pem` to the laptop. The worker refuses a LAN listener without TLS. Permit inbound TCP 4318 only from the laptop's private address. The UXP bridge on 4319 stays loopback-only.

```powershell
npm run adobe:doctor
powershell -NoProfile -ExecutionPolicy Bypass -File tools/scripts/start-adobe-worker.ps1
```

On the laptop, set `FREEOS_ADOBE_ENABLED=true`, `FREEOS_ADOBE_WORKER_MODE=orchestrator`, `FREEOS_ADOBE_WORKER_URL=wss://192.168.1.152:4318/adobe/worker`, and the same `FREEOS_ADOBE_WORKER_TOKEN`. Set `NODE_EXTRA_CA_CERTS` in the shell **before** starting Node, pointing to the copied `worker-cert.pem`. Keep `FREEOS_ADOBE_BRIDGE_TOKEN` on the AIO only; enter it into each local plugin panel. Run `npm run build:api`, restart the API, then run `npm run adobe:status`.

```powershell
cd E:\FREEOS
$env:NODE_EXTRA_CA_CERTS = 'E:\FREEOS\generated\adobe-worker\tls\worker-cert.pem'
npm run dev:api
```

The setup script defaults the worker to loopback. Changing the host and supplying TLS is the explicit step that enables LAN control. Keep the `.env` file private.
