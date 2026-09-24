# Reconciling SECURITY_AUDIT.md With Tracked Issues

`SECURITY_AUDIT.md` lists findings by category. This document defines how
each finding stays linked to an actively tracked GitHub issue instead of
going stale.

## Cross-reference

| Finding (SECURITY_AUDIT.md)            | Tracking issue                        | Status                 |
| -------------------------------------- | ------------------------------------- | ---------------------- |
| Secret-key base64 encryption           | Original flagged issue (pre-existing) | Remediated             |
| Broader secrets-at-rest audit          | #547                                  | Closed by this PR      |
| Dependency vulnerability scanning gate | #548                                  | Closed by this PR      |
| API key rotation/revocation            | #549                                  | Closed by this PR      |
| Webhook secret encryption-at-rest gap  | Not yet filed                         | Open — needs new issue |

## Process going forward

1. Any new row added to `SECURITY_AUDIT.md` must include a `Status` value.
2. A finding may not be marked `Remediated` without a linked issue number
   that was actually closed.
3. A finding with `Status: Gap` and no issue number must have one filed
   before the next audit pass, per the table above.
4. This table is reviewed whenever `SECURITY_AUDIT.md` changes, so findings
   cannot silently go untracked.
