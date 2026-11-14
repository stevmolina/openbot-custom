### Fixed

- The web app no longer shows "Reconnecting" each time you come back to it. The notice now waits 8 seconds, so a normal reconnect after a phone pauses the app shows nothing. A longer outage still shows the notice.
- A request that fails only because the server link is down no longer shows a red error. The workspace loads again after the reconnect.
