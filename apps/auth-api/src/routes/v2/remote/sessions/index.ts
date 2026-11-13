import { isString } from "@openbot/contracts/runtime-values";
import { createFileRoute } from "@tanstack/solid-router";
import { Effect } from "effect";
import { sha256 } from "../../../../server/crypto";
import { runApiResponse } from "../../../../server/effect-runtime";
import { readJsonObject } from "../../../../server/json-body";
import {
  apiError,
  bearerToken,
  json,
  remoteControlPlaneErrorResponse,
  requestRemoteControlPlane,
  requestUser,
} from "../../../../server/request-auth";

export const Route = createFileRoute("/v2/remote/sessions/")({
  server: {
    handlers: {
      POST: ({ request }) =>
        runApiResponse(
          Effect.gen(function* () {
            const token = bearerToken(request);
            if (!token) return apiError(401, "unauthorized", "Sign in is required.");
            const user = yield* requestUser(request);
            if (!user) return apiError(401, "unauthorized", "Sign in is required.");
            const body = yield* readJsonObject(request);
            if (!isString(body.hostId)) return apiError(400, "invalid_remote_request", "The host ID is invalid.");
            const remote = requestRemoteControlPlane();
            const session = yield* remote.startSession(user.id, body.hostId, yield* sha256(token));
            // With the client key, the first ticket comes in the same answer: one round trip less before Signal.
            if (!isString(body.clientPublicKey)) return json(session, 201);
            const ticket = yield* remote.issueSessionTicket(user.id, session.sessionId, body.clientPublicKey);
            return json({ ...session, ticket }, 201);
          }),
          remoteControlPlaneErrorResponse,
        ),
    },
  },
});
