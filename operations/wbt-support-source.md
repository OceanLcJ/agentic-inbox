# What Brandon Thinks contact-form intake

The project directory and SMTP domain routing do not cover website forms. What Brandon Thinks sends contact-form notifications directly to the operator's QQ inbox, so the hourly Inbox scan also reads a private `SupportInboxSource` service binding.

- WBT `workers/support-inbox-source.ts` exports a named Worker entrypoint. Only GET `/requests` is supported; the ordinary public HTTP handler is preserved.
- `src/mail/support-inbox-feed.ts` reads active, unexpired `support_request` records and their already-sent acknowledgements/replies. It decrypts support payloads inside the WBT Worker. Encryption keys, payments, accounts and raw conversations are not returned. Pages contain at most 50 requests.
- Inbox `workers/lib/support-source.ts` validates that feed, imports stable message IDs, and records source evidence. Automatic acknowledgements do not count as a substantive reply. Existing business replies enter the conversation and duplicate-reply guard.
- The email entered in a form has not established account ownership. Account changes, refunds and deletion still need verification and owner approval.
- `WBT_SUPPORT_SYNC_START_AT` is the fixed integration cutoff. Older requests without a recorded business reply wait in `needs_owner` until their prior QQ handling is checked. Repeated scans must preserve owner decisions and later customer messages.
- The QQ notification and original WBT lifecycle outbox remain in place. Expired/scrubbed source payloads are not resurrected by this feed.

Future normal WBT releases retain the entrypoint export in `workers/app.ts`. For the initial attachment, `operations/support-source-bridge.mjs` preserved the live application's modules byte for byte (including binary files), bindings, static assets, routes and cron schedule. The script requires a private download/settings/deployment packet under `.local-setup/wbt-feedback-incident`, a `wrangler whoami` check, and `--source-root /absolute/what-brandon-thinks`. It only applies with `--apply`, and rejects a changed live version or binding set. These private artifacts and customer messages must never enter Git.

Release acceptance: run both repositories' mail/support tests, check the source feed and Inbox `/scan` errors, compare all existing bindings/settings/triggers, verify the public application still serves its original handler, and confirm one case with its actual original source reply. Scan the same feed twice and verify case/event counts are stable. Confirm anonymous Inbox access and owner-only actions remain protected.
