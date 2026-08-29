# GitHub settings audit — 2026-08-29

Repository: `theronic/eacl-demo`

The GitHub REST API reports `demos` as the default branch. Both
`GET /branches/main/protection` and `GET /branches/demos/protection` return
HTTP 404 (`Branch not protected`). `GET /rulesets` returns an empty array.

The repository therefore has no classic branch-protection rule and no
repository ruleset restricting direct pushes to either `main` or `demos`.
A direct push to `demos` triggers `.github/workflows/deploy-demos.yml`, whose
five independent jobs build and deploy all currently live demos.

This intentionally supersedes the 2026-08-27 `demos` pull-request restriction.
GitHub deployment environments and exact AWS OIDC trust remain the production
authorization boundary.
