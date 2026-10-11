const base = process.env.FREEOS_API_URL || "http://127.0.0.1:3001";
try { const response = await fetch(`${base}/adobe/status`); if (!response.ok) throw new Error(`HTTP ${response.status}`); console.log(JSON.stringify(await response.json(), null, 2)); }
catch (error) { console.error(`Adobe API unavailable: ${error.message}`); process.exitCode = 1; }
