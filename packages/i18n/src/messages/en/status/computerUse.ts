import { defineMessages } from "../../../message";

export const messages = defineMessages("status.computerUse", {
  // Computer Use driver status.
  "status.computerUse.driverNotStarted": "The Computer Use driver did not start. {reason}",
  "status.computerUse.driverStoppedBeforeAnswer": "The Computer Use driver stopped before it could answer.",
  "status.computerUse.driverNoAnswer": "The Computer Use driver did not answer. {reason}",
  "status.computerUse.driverStopped": "The Computer Use driver stopped.",
  "status.computerUse.unsupported": "Computer Use is available on macOS, Windows and Linux.",
  "status.computerUse.driverMissing": "This build of OpenBot carries no Computer Use driver.",
  // Computer Use progress on the agent's activity line.
  "status.computerUse.progressActing": "Using an app on this computer…",
  "status.computerUse.progressDeciding": "Deciding the next step in the app…",
  // Who holds an app that Computer Use refused, and the label of each agent cursor.
  "status.computerUse.ownChat": "own chat",
  "status.computerUse.anotherAgent": "another agent",
  "status.computerUse.joinedServer": "a joined server",
  "status.computerUse.unnamedThread": "a side thread",
  "status.computerUse.thisApp": "This app",
});
