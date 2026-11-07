import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/error/computerUse";

export const messages = {
  "error.computerUse.noAppToDrag": "この OpenBot ビルドにはドラッグするアプリケーションがありません。",
  "error.computerUse.helpWindowChanged": "ドラッグを開始する前に、権限のヘルプウィンドウが変わりました。",
  "error.computerUse.noAppToShow": "この OpenBot ビルドには表示するアプリケーションがありません。",
  "error.computerUse.noDriver": "このコンピューターには Computer Use ドライバーがありません。",
  "error.computerUse.socketPathTooLong":
    "Computer Use のソケットパスは {length} 文字ですが、このシステムでは {limit} 文字までです。",
  "error.computerUse.socketDirectoryNotDirectory":
    "Computer Use のソケットディレクトリ {path} はディレクトリではありません。",
  "error.computerUse.socketDirectoryOtherOwner":
    "Computer Use のソケットディレクトリ {path} は別のユーザーが所有しています。",
  "error.computerUse.socketDirectoryShared":
    "Computer Use のソケットディレクトリ {path} は他のユーザーに公開されています。",
  "error.computerUse.socketNotReady": "{seconds} 秒以内に接続を受け付けませんでした。{reason}",
  "error.computerUse.appInUse":
    "{app} は {agent}（{thread}）が使用中です。後でもう一度試すか、別のアプリを使ってください。",
  "error.computerUse.desktopBusy":
    "このコンピューターの別の操作が時間内に終わりませんでした。少し待ってからもう一度試してください。",
} as const satisfies PartialTranslation<typeof source>;
