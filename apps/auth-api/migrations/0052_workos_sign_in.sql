-- Deployment-wide WorkOS account sign-in. Company domain connections are separate.
CREATE TABLE workos_sign_in_identities (
  issuer TEXT NOT NULL,
  subject TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (issuer, subject)
);
CREATE TABLE workos_sign_in_flows (
  state_hash TEXT PRIMARY KEY,
  issuer TEXT NOT NULL,
  client_id TEXT NOT NULL,
  verifier TEXT NOT NULL,
  nonce TEXT NOT NULL,
  return_to TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  client_state TEXT NOT NULL,
  client_challenge TEXT NOT NULL,
  mobile INTEGER NOT NULL CHECK (mobile IN (0, 1)),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX workos_sign_in_flows_expiry ON workos_sign_in_flows(expires_at);
CREATE TABLE workos_sign_in_codes (
  code_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_challenge TEXT NOT NULL,
  configuration_hash TEXT NOT NULL,
  mobile INTEGER NOT NULL CHECK (mobile IN (0, 1)),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  redeemed_at INTEGER,
  session_id TEXT
);
CREATE INDEX workos_sign_in_codes_expiry ON workos_sign_in_codes(expires_at);
