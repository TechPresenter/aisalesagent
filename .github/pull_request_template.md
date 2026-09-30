## What this changes

<!-- One or two sentences, with a link to the task or bug-list entry. -->

## Checklist

<!-- Keep the section for this pull request's target branch and delete the rest. -->

### Into `develop` (feature or fix)

- [ ] `npm run typecheck`, `npm run lint` and `npm test` pass locally
- [ ] Any database change still works with the code currently on LIVE (see "Database changes" in docs/deployment.md)

### `develop` → `qa` (start a QA cycle)

- [ ] Smoke-tested on DEV after the last merge
- [ ] Scope of this QA cycle listed above

### `qa` → `uat` (QA passed)

- [ ] QA Testing Report linked
- [ ] No open Critical or High bugs

### `uat` → `main` (release to LIVE)

- [ ] Formal UAT approval / sign-off from the client linked
- [ ] Rollback target noted: the current LIVE deployment, and whether this release migrates the database
- [ ] Someone is named to run the post-release smoke test
