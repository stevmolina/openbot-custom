import { createFileRoute } from "@tanstack/solid-router";
import { Effect } from "effect";
import { runApiResponse } from "../../../../../server/effect-runtime";
import { readJsonObject } from "../../../../../server/json-body";
import {
  remoteControlPlaneErrorResponse,
  requestRemoteControlPlane,
  requestWebPushRelay,
} from "../../../../../server/request-auth";
import { relayWebNotification } from "../../../../../server/web-push-relay";

/**
 * A host sends one encrypted notification for a member's web client. The body has the host credential,
 * the push endpoint of the browser, the client session and encrypted bytes. Nothing of it is stored or
 * logged. This service sends only to a known push service, signed with its VAPID key.
 */
export const Route = createFileRoute("/v2/remote/hosts/$hostId/web-notification")({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        runApiResponse(
          Effect.gen(function* () {
            const body = yield* readJsonObject(request);
            const controlPlane = requestRemoteControlPlane();
            return yield* relayWebNotification(params.hostId, body, {
              relay: requestWebPushRelay(),
              authenticateHost: (hostId, machineToken) => controlPlane.authenticateHost(hostId, machineToken),
              sessionOpen: (hostId, sessionId) => controlPlane.sessionOpen(hostId, sessionId),
            });
          }),
          remoteControlPlaneErrorResponse,
        ),
    },
  },
});
