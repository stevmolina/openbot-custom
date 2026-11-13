import { useText } from "@openbot/ui/text";
import { toast } from "@openbot/ui/toast";
import { onSettled } from "solid-js";
import { applyWebUpdate, onWebUpdateReady, registerWebServiceWorker } from "./web-service-worker";

const UPDATE_TOAST_ID = "web-update-ready";

/**
 * Starts the service worker of the web client, and offers a reload when a new version is waiting. It
 * shows nothing otherwise. "Reload" makes the new worker active, and the page reloads once.
 */
export function WebServiceWorkerUpdates() {
  const { t } = useText();
  onSettled(() => {
    registerWebServiceWorker();
    return onWebUpdateReady(() => {
      toast(t("webClient.update.ready"), {
        id: UPDATE_TOAST_ID,
        duration: Number.POSITIVE_INFINITY,
        action: { label: t("webClient.update.reload"), onClick: () => void applyWebUpdate() },
      });
    });
  });
  return null;
}
