### Fixed

- Several OpenBot instances on one host (`docker/instances`) can no longer use swap after `systemctl daemon-reload`. Each container is now in `openbot.slice`, which keeps swap at 0. Run `openbot-instance setup`, then `openbot-instance up <name>` for each instance.
