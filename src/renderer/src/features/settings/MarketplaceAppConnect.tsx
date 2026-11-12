import type { MarketplaceApp } from "@openbot/ui/features/marketplace/marketplace-model";
import { createEffect, createMemo, merge, untrack } from "solid-js";
import { actionToast } from "../../action-toast";
import { MarketplaceDialogs } from "./MarketplaceDialogs";
import { createMarketplaceController, type MarketplaceControllerProps } from "./marketplace-controller";

export interface MarketplaceAppConnectProps extends Omit<MarketplaceControllerProps, "open" | "onOpenChange"> {
  /** The catalog plugin slug of the suggestion card. */
  appId: string;
  /** The connect step ended: the app connected, the person closed the dialog, or it failed with a toast. */
  onDone: () => void;
  /**
   * The app cannot connect from here, for example for a member of a joined server, or this client does
   * not have it. Its Marketplace page tells why.
   */
  onOpenPage: (appId: string) => void;
}

/**
 * The connect step of one catalog plugin over the chat, for Connect on a suggestion card. The person
 * stays in the chat: the plugin's sign-in and approval dialog opens over it, and closes when the app
 * is connected or the person cancels. A failure shows as a toast. A connector, whose connect step is
 * on its page, still opens Marketplace.
 */
export function MarketplaceAppConnect(props: MarketplaceAppConnectProps) {
  const controllerProps = merge(props, {
    open: true,
    onOpenChange: (open: boolean) => {
      if (!open) props.onDone();
    },
  });
  const controller = createMarketplaceController(controllerProps);
  const model = controller.model;
  /** The step runs once. A later change of the app list does not start it again. */
  let started = false;

  /** The app, when the host's apps are read, so a connected app is not connected again. Null: not here. */
  const ready = createMemo((): MarketplaceApp | null | undefined =>
    controller.appStatesRead() ? (model.apps().find((app) => app.id === props.appId) ?? null) : undefined,
  );

  const start = (app: MarketplaceApp | null) => {
    if (app?.status === "connected") {
      props.onDone();
      return;
    }
    // The page tells why the app does not connect here, for example for a member of a joined server.
    if (app?.kind !== "plugin" || !model.canConnectApps()) {
      props.onOpenPage(props.appId);
      return;
    }
    void model.connectApp(app).then(() => {
      // A closed connect dialog is the person's decision: it ends with no toast.
      const failure = untrack(model.error);
      const notice = untrack(model.notice);
      if (failure) actionToast.error(failure);
      else if (notice) actionToast.success(notice);
      props.onDone();
    });
  };

  // The callbacks read props in `untrack`: a conditional prop makes a memo when it is read, and a memo
  // made in an effect callback halts the UI.
  createEffect(ready, (app) => {
    if (app === undefined || started) return;
    started = true;
    untrack(() => start(app));
  });
  /* The step waits for the host's MCP servers. When that read fails, it cannot start. */
  createEffect(
    () => model.error(),
    (failure) => {
      if (!failure || started) return;
      started = true;
      actionToast.error(failure);
      untrack(() => props.onDone());
    },
  );

  return <MarketplaceDialogs controller={controller} hostName={props.pluginHostName} relay={props.pluginSignInRelay} />;
}
