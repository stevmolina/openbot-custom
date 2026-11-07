import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/computerUse";

export const messages = {
  // Computer Use driver status.
  "status.computerUse.driverNotStarted": "Computer Use 驱动未能启动。{reason}",
  "status.computerUse.driverStoppedBeforeAnswer": "Computer Use 驱动在响应之前就停止了。",
  "status.computerUse.driverNoAnswer": "Computer Use 驱动没有响应。{reason}",
  "status.computerUse.driverStopped": "Computer Use 驱动已停止。",
  "status.computerUse.unsupported": "Computer Use 可在 macOS、Windows 和 Linux 上使用。",
  "status.computerUse.driverMissing": "该版本的 OpenBot 不包含 Computer Use 驱动。",
  // Computer Use progress on the agent's activity line.
  "status.computerUse.progressActing": "正在操作这台电脑上的应用…",
  "status.computerUse.progressDeciding": "正在决定应用中的下一步…",
  "status.computerUse.mainChat": "主聊天",
  "status.computerUse.anotherAgent": "另一个代理",
  "status.computerUse.joinedServer": "已加入的服务器",
  "status.computerUse.unnamedThread": "一个侧边线程",
  "status.computerUse.thisApp": "此应用",
} as const satisfies PartialTranslation<typeof source>;
