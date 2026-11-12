### Added

- Create an Artifact is available in the phone message menu and in existing desktop and web side threads. The selected chip says Artifact · This message and can be removed before Send.

### Fixed

- Artifact requests keep their mode through queue edits, retries, reloads and continuations. They run separately from ordinary queued requests. The next ordinary request has no Artifact tools unless Use claude.ai tools is on.
- Selecting Artifact tools does not enable claude.ai connectors. The global Use claude.ai tools setting still enables both.
- A tool-mode change waits for Claude's background work, then resumes the same session.

- **Update joined servers to use the phone control and side-thread option.**
