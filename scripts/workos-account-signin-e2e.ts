import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../apps/auth-api/scripts/workos-account-signin-e2e.ts", import.meta.url));
const result = spawnSync(process.execPath, [script], { stdio: "inherit", env: process.env });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
