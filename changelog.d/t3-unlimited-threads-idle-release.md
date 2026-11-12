### Changed

- Side threads of an agent no longer wait for each other by default. Before, a fifth message waited with "Waiting for a free thread. 4 threads run now." Now every side thread runs at once, and the memory of the computer is the only limit. A limit from 1 to 4 that you set in the agent's settings still applies.

### Added

- A side thread that runs or has waiting messages has Stop in the right-click menu of its tab.
- When a limit that you set holds a message, the thread lists the other threads that run, each with a Stop button.
