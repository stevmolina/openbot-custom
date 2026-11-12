### Changed

- The custom build is now Pokebots. It installs as `/Applications/Pokebots.app`, and the Dock, the menu bar, windows, notifications and all interface text say Pokebots. The install script backs up and removes the old `OpenBot Custom.app`. The data folder, the saved sign-in keys and the macOS privacy grants stay the same.
- Pokebots uses the self-hosted account service `api.pokebots.xyz` and its Signal `signal.pokebots.xyz`, not `openbot.run`. Sign out of `openbot.run` before the first start, then sign in again.
- A self-hosted account Worker built with `OPENBOT_BRAND_NAME=Pokebots` shows Pokebots on its pages and in its sign-in and invitation email.
