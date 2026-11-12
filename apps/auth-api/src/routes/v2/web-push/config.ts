import { createFileRoute } from "@tanstack/solid-router";
import { requestWebPushPublicKey } from "../../../server/request-auth";

/**
 * The VAPID public key that the web client subscribes with, or `null` when this service has no Web Push
 * relay. The web client offers notifications while it is closed only with a key. The path is
 * `WEB_PUSH_CONFIG_ROUTE` of `@openbot/contracts/web-push`.
 */
export const Route = createFileRoute("/v2/web-push/config")({
  server: {
    handlers: {
      GET: () =>
        Response.json(
          { publicKey: requestWebPushPublicKey() },
          { headers: { "Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff" } },
        ),
    },
  },
});
