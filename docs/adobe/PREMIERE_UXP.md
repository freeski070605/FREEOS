# Premiere bridge

Requires Premiere Pro 25.6 or newer. Enable Developer Mode in Premiere's Plugins preferences. Open UXP Developer Tool, add `adobe/premiere-uxp`, and load it into Premiere. Open Window > UXP Plugins > FREEOS Premiere Bridge and enter `FREEOS_ADOBE_BRIDGE_TOKEN` from the AIO `.env`.

The bridge implements project inspection, project item traversal, open, save, save as, sequence inspection with video/audio track items, marker inspection, settings inspection, and sequence clone. Cloning names the new sequence `BLAKEO_FREEOS_PASS_01` style and selects it. The original synced sequence remains untouched. Project paths are checked by the worker before native calls. The plugin uses Premiere's `Project`, `Sequence`, `VideoTrack`, and `AudioTrack` UXP APIs. Premiere documents these APIs at [Project](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/project) and [Sequence](https://developer.adobe.com/premiere-pro/uxp/ppro-reference/classes/sequence).

The manifest allows only the AIO loopback WebSocket. If the worker port changes, update the manifest and plugin URL together. Reconnect by reopening the panel and entering the bridge token. UXP plugin installation and Developer Mode details are in [Adobe's installation guide](https://developer.adobe.com/premiere-pro/uxp/plugins/distribution/install/).
