# Secret scanning

`node scripts/scan-secrets.mjs` scans every regular repository and build-output file, including binary bytes, static bundles, source maps, logs, descriptors, locks, and manifests. It rejects private-key blocks, AWS access/secret keys, GitHub and Slack tokens, Telegram bot tokens, JWTs, credential-bearing query parameters, and URLs with embedded basic-auth credentials.

Findings print only the rule, relative file, byte offset, and a short one-way fingerprint; the suspected value is never echoed into CI logs or the report. The machine-readable report is written to ignored `dist/secret-scan-report.json` and excludes itself from the next scan. Commit hashes, artifact digests, public AWS resource ARNs, secret *names*, redacted markers, and environment-variable references are not credentials and are not blocked by shape alone.

The scanner is a mandatory build gate, but it does not legitimize putting credentials in source. AWS deploy access uses OIDC, the Telegram bot token stays in AWS Secrets Manager, function configuration carries only non-secret coordinates, and browser bundles never receive backend connection strings or signing material.
