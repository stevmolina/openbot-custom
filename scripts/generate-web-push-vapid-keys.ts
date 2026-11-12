// Makes a VAPID key pair (RFC 8292) for the Web Push relay of the account service, the one that sends
// web client notifications. It prints three lines for the encrypted environment file of the Worker;
// nothing is written or sent. Keep the private key secret. A new pair ends every web client
// subscription: each web client subscribes again with the new public key when it next opens.
//
// Run: bun scripts/generate-web-push-vapid-keys.ts <mailto:address | https:// contact URL>
// Then, with the root `.env.keys`, for each line: `bunx dotenvx set NAME 'value' -f apps/auth-api/.env.production -fk .env.keys`
import { generateKeyPairSync } from "node:crypto";
import { readWebPushVapidConfig } from "../apps/auth-api/src/server/web-push-relay";

const subject = process.argv[2];
if (!subject) throw new Error("Pass the contact that push services see: a mailto: address or an https: URL.");
const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const jwk = privateKey.export({ format: "jwk" });
if (!jwk.x || !jwk.y || !jwk.d) throw new Error("The key has no coordinates.");
const publicKey = Buffer.concat([
  Buffer.from([0x04]),
  Buffer.from(jwk.x, "base64url"),
  Buffer.from(jwk.y, "base64url"),
]).toString("base64url");
const privateJwk = JSON.stringify({ kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y, d: jwk.d });
if (!readWebPushVapidConfig({ privateKey: privateJwk, publicKey, subject })) {
  throw new Error("The subject must be a mailto: address or an https: URL.");
}
process.stdout.write(`WEB_PUSH_VAPID_PRIVATE_KEY=${privateJwk}\n`);
process.stdout.write(`WEB_PUSH_VAPID_PUBLIC_KEY=${publicKey}\n`);
process.stdout.write(`WEB_PUSH_VAPID_SUBJECT=${subject}\n`);
