# FREEOS 1.3 Browser Operator Foundation

Browser Operator uses Playwright Core with an installed Edge or Chrome executable. It does not download a browser runtime or use a cloud browser. Its profile is `data/browser/profile`; FREEOS never attaches to a personal browser profile or reads unrelated cookies, passwords, autofill, or payment databases. Session metadata and redacted action URLs are kept in `data/browser/sessions.json`. Browser screenshots live in `data/browser/screenshots` with a 20 image retention limit. Downloads are unavailable in this foundation, even if their environment flag is changed.

## Workflow

Observe → Navigate → Inspect → Prepare → Approve → Execute → Verify → Audit. Start a local session, preview a URL, create a Tool Runner navigation request, inspect the resulting page, then create a separate request for each action. The dashboard reuses the existing Approval Hub. Chat can suggest or summarize observed content; it cannot silently run browser actions. There is no browsing loop.

`BROWSER_ENABLED` gates the browser service. `BROWSER_CONTROL_ENABLED` separately gates navigation and interaction. `BROWSER_SCREENSHOT_ENABLED` gates browser page captures independently from Computer Operator capture. `BROWSER_DOWNLOADS_ENABLED` defaults to false; a download executor is intentionally unavailable. `COMPUTER_CONTROL_ENABLED` and `COMPUTER_SCREEN_CAPTURE_ENABLED` remain false and independent.

## Site permissions

Site permissions are stored locally in `data/browser/permissions.json` as an array of `{ "origin": "https://example.com", "permissions": ["observe", "navigate", "interact", "download"], "enabled": true }`. The file is created through the Browser Core `setPermissions` API or can be provisioned locally while the API is stopped. Origins are normalized. `localhost`, `127.0.0.1`, and `::1` receive observation and navigation for development; no origin receives interaction by default. An `interact` grant never implies messaging, publishing, purchasing, credential management, or financial execution. The Browser panel displays configured grants. Changes to site permission storage should be made only by a trusted local operator.

Only HTTP and HTTPS URLs are accepted. Userinfo credentials and privileged or custom schemes are blocked. Navigation and redirect requests are checked against origin grants. A blocked redirect cannot become an interaction target. Page inspection returns bounded headings, landmarks, visible controls, links, inputs, and element references; it does not return raw HTML. References are invalidated on navigation. Text extraction is capped by `BROWSER_MAX_TEXT_CHARS`.

Navigation, click, input, select, check, uncheck, and form submit are medium risk Tool Runner actions. They require request → approve → run and permission rechecks. Inputs are held in API memory until execution and redacted in SQLite and audit output; restarting expires them. Form filling and submitting are distinct. `browser.form.preview` shows origin, action URL, method, visible field names, redacted sensitive values, and submit label. Password input requires its own approved request. Payment fields and obvious purchases, trades, transfers, gambling, messaging, publishing, applications, legal signing, account deletion, and password changes are blocked. General browser control cannot authorize them.

Downloads are not opened, executed, or saved by this phase. Browser Operator never receives source-write authority; Safe Coding Workspace remains separately approved. Browser automation uses browser-native selectors and methods, not Computer Operator mouse/keyboard control. The local browser profile can contain site session data created there; protect the workstation and profile directory accordingly.

## Tools and routes

Read-only Tool Runner keys: `browser.status`, `browser.sessions.list`, `browser.session.start`, `browser.session.stop`, `browser.tabs.list`, `browser.page.inspect`, `browser.page.text`, `browser.page.links`, `browser.page.forms`, `browser.page.elements`, `browser.page.screenshot`, `browser.navigation.preview`, `browser.form.preview`. Action keys: `browser.navigate`, `browser.click`, `browser.input`, `browser.select`, `browser.check`, `browser.uncheck`, `browser.form.submit`, `browser.download` (blocked). API routes under `/browser` expose status, sessions, start/stop, tabs, inspection, text, links, forms, elements, screenshot, navigation preview, and form preview. Actions are only available through `/tools/requests`, approval, and run routes.

Run `npm run test:browser` with the installed local Edge/Chrome. Tests use a loopback HTTP fixture and temporary profile/database. No external accounts are used.

## Chrome-first persistent FREEOS profile

Google Chrome is preferred by default, with Microsoft Edge as fallback. `BROWSER_PREFERRED_ENGINE=chrome`, `edge`, or `auto` selects the order (`auto` uses Chrome first). Only standard Windows Program Files and Local AppData browser paths are checked; no runtime is downloaded. Status exposes the preferred and active engine without the executable path. The dedicated `data/browser/profile` persists cookies, sessions, and site settings created inside FREEOS. Personal profiles, passwords, history, autofill, payment data, and extensions are never imported.
Browser sessions are visible by default (`BROWSER_HEADLESS=false`) so the local user can sign in manually within the FREEOS profile. Set `BROWSER_HEADLESS=true` only when a visible session is unnecessary.
