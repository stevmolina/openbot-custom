### Added

- Add optional WorkOS OIDC account sign-in for self-hosted account services. WorkOS invitations can
  restrict registration without company email domains. Server memberships still require OpenBot
  invitations.
- Add local OIDC and staging sign-in checks with JSON reports.

### Security

- In WorkOS mode, email-code and company-provider account sign-in paths fail closed, including
  partial configuration. Browser sign-in uses an HttpOnly flow cookie; native exchanges use PKCE
  and one-use codes.
