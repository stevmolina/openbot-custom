### Added

- Every thread of an agent can now use Computer Use: the agent's own chat, each task and each routine thread. Before, only the agent's own chat could control the computer.
- OpenBot now takes turns between agents and threads that use the computer at the same time. Input actions run one at a time, in the order they were asked. The first conversation that types or clicks in an app holds it until its turn ends or it stops for a minute. Another conversation that tries to use that app gets a clear message that names the agent and the thread that use it.
- Each agent that uses the computer now shows its own cursor, in the agent's colour and with the agent's name.

### Changed

- After this update, each Codex conversation with Computer Use starts a new provider session once. The chat history stays.
