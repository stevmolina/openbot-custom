### Changed

- OpenBot Custom updates itself on Steven's Mac: a launchd job builds each new commit of `main`, waits until no local agent works, then quits, installs and reopens the app. Agents no longer build it after a merge.
