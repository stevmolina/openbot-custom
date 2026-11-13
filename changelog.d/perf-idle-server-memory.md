### Changed

- A self-hosted or hosted server no longer loads the app page in its hidden window, and it has no Dynamic Island. Before, each server kept the full app page and its graphics process running for nobody, about 400 MB and a steady part of a core while idle. Remote clients, agents and the agent browser work as before. **The server must also be on this version: install it in Server Settings > Updates, or restart the server.**
- The open browser tab of an agent now sleeps after 15 minutes when the agent runs no turn and nobody shows the tab in the browser panel. Before, the active tab of an agent never slept and its memory grew for hours. The next use loads the page again.
