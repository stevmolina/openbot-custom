// The Computer Use driver's readiness, and the macOS permission panes it may need.

import { parseRemoteComputerServerId, parseSetRemoteComputerServerInput } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { ComputerUsePermissionHelpWindowController } from "../computer-use-permission-help-window";
import type { CuaDriverRuntime } from "../cua-driver-runtime";
import { MAC_PERMISSION_URLS } from "../mac-permission-urls";
import type { RemoteComputerClient } from "../remote-computer-client";
import type { RemoteServerManager } from "../remote-server-manager";
import { parseMacPermission } from "./app-inputs";
import { eventHandler, handler, type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";

const logger = createOpenBotLogger("computer-use");

// Only the methods these endpoints call. Naming that much lets a test pass a double without an
// assertion, and keeps the group from reaching further into either owner than it needs to.
export interface ComputerUseIpcDependencies {
  cuaDriver: Pick<CuaDriverRuntime, "state">;
  openExternal: (url: string) => Promise<void>;
  permissionHelp: Pick<
    ComputerUsePermissionHelpWindowController,
    "show" | "close" | "permissionApp" | "startDrag" | "reveal"
  >;
  /** The switches of the joined servers. Null where this app joins no server. */
  remoteServers: Pick<RemoteServerManager, "remoteComputerServers" | "setRemoteComputerServer"> | null;
  /** The agents of joined servers that use this computer now. Null on a server. */
  remoteComputers: Pick<RemoteComputerClient, "sessions" | "stop" | "resume"> | null;
}

/**
 * Six endpoints. Two of them answer with the whole state.
 *
 * Opening a pane returns the state again rather than nothing, because the user grants the
 * permission in System Settings and comes back: re-reading on the way out is what lets the panel
 * show the new answer without a second call.
 *
 * The pane also brings up the help window, because System Settings opens in front of everything and
 * leaves the panel that asked for the grant behind it. The steps have to stay where the user is
 * working, which at that moment is System Settings.
 *
 * Only macOS has a pane to open. On Windows and Linux the state reports no permissions, so the
 * panel draws no row that could call any of this.
 */
export function computerUseIpcHandlers({
  cuaDriver,
  openExternal,
  permissionHelp,
  remoteServers,
  remoteComputers,
}: ComputerUseIpcDependencies): Pick<IpcGroupHandlers, "computerUse"> {
  const state = () => runCauseEffect(cuaDriver.state());
  // A server offers nothing: it has no person at its screen to see the agent work.
  const servers = () => (remoteServers && remoteComputers ? remoteServers.remoteComputerServers() : []);
  return {
    computerUse: {
      getState: handler(state),
      openPermissionPane: payloadHandler(parseMacPermission, async (permission) => {
        await openExternal(MAC_PERMISSION_URLS[permission]);
        // Reported and then left: the pane is open either way. The reason is logged, because a
        // window that never came up leaves the user with a pane and no steps and no other sign.
        await runCauseEffect(permissionHelp.show(permission)).catch((cause) => {
          logger.warn("The Computer Use permission steps could not be shown.", { cause: toLogValue(cause) });
        });
        return state();
      }),
      closePermissionHelp: handler(async () => {
        permissionHelp.close();
      }),
      getPermissionApp: eventHandler((event) => runCauseEffect(permissionHelp.permissionApp(event.sender.id))),
      // The one sender-identity case in this group. A drag carries a file to wherever the pointer
      // is let go, so the window it starts in has to be the window the user is dragging from; the
      // trusted-URL gate cannot tell, because every window of the app shares one origin.
      startPermissionAppDrag: eventHandler((event) => runCauseEffect(permissionHelp.startDrag(event.sender))),
      revealPermissionApp: eventHandler(async (event) => {
        permissionHelp.reveal(event.sender.id);
      }),
      listRemoteServers: handler(async () => servers()),
      setRemoteServer: payloadHandler(parseSetRemoteComputerServerInput, async ({ serverId, enabled }) => {
        if (!remoteServers || !remoteComputers) throw new Error(sourceText("error.team.agentSettingsUnsupported"));
        await runCauseEffect(remoteServers.setRemoteComputerServer(serverId, enabled));
        // The user's own switch is the newest answer, also after a Stop whose write failed.
        if (enabled) remoteComputers.resume(serverId);
        return servers();
      }),
      getRemoteSessions: handler(async () => remoteComputers?.sessions() ?? []),
      stopRemoteSession: payloadHandler(parseRemoteComputerServerId, async (serverId) => {
        if (remoteComputers) await runCauseEffect(remoteComputers.stop(serverId));
      }),
    },
  };
}
