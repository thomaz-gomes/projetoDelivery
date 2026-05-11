# Cron scripts

Standalone scripts intended to be invoked by the host's crontab (or any
scheduler) — not by the backend process itself. Each script is idempotent
and supports `--dry-run`.

## refreshMetaTokens.js

Refreshes Meta long-lived tokens for any `MetaMessagingAccount` whose
`tokenExpiresAt` is within the next 7 days. Failed refreshes mark the
account `DISCONNECTED` with `lastError`.

```bash
# Manual run / smoke test
node scripts/cron/refreshMetaTokens.js --dry-run

# Suggested host crontab (daily at 03:15)
15 3 * * * cd /opt/delivery/delivery-saas-backend && node scripts/cron/refreshMetaTokens.js >> /var/log/delivery/refresh-meta-tokens.log 2>&1
```
