# Recovery write compatibility gate

The project document update rule preserves the existing Google-authenticated
membership, owner, type and schema checks. It adds one compatibility check:

- A document without either recovery marker remains editable by existing clients.
- Once `recoveryWriteToken` or `recoveryWriteRevision` exists, every project
  update must include a different string token with at least 16 characters and
  an integer revision exactly one higher than the stored revision (default 0).

An older client copying the latest project or sending a stale complete document
does not advance the revision and generate a new token, so its write is rejected
after that project has been upgraded. Replaying an older, different token with an
older revision is also rejected. Reads, invitations, membership and user indexes use their existing
rules. An owner may still permanently delete the entire project.

This token is public project metadata. It is **not** a security secret and does
not make the embedded activity history immutable against a modified client.

## Frontend requirements

Every transaction that writes the project document must generate one new token
outside its retry callback and include it in the final project write. Calculate
`recoveryWriteRevision = (Number(latest.recoveryWriteRevision) || 0) + 1` from the
latest snapshot **inside** the callback on each transaction attempt:

1. Editing or adding an entry, settings or members stored inside project data.
2. Deleting/restoring a single entry or an entire day; adding a day.
3. Dining-to-travel import: both the source and target project write.
4. Expired-trash cleanup, including cleanup with no user edit.
5. Initial migration on open, even when there is no expired trash to remove.

Creating a new project should include its first token and revision 1. Generate fresh tokens per
transaction; use the same token on Firestore's retries of that transaction. Never
delete or reuse a prior token. Token migration and normal updates must read the
latest document inside a transaction so simultaneous writers cannot restore a
stale project snapshot.

Deploy these rules before deploying the recovery frontend. Old clients remain
usable until a newer client opens/upgrades their project, after which they must
reload to obtain the newer app before editing again. Frontend-only tests cannot
establish that production rules have been deployed.

## Local emulator tests

The test file deliberately refuses any non-local emulator address and uses the
`demo-aa-recovery-rules` project ID. It never loads production credentials.

Install test tools outside the application checkout, for example:

```sh
npm install --prefix /workspace/setup-tools/recovery-rules \
  --cache /workspace/scratch/npm-recovery-cache --no-package-lock \
  firebase-tools@14 @firebase/rules-unit-testing@4 firebase@11
```

Start Firestore Emulator with this repository's rules, then run:

```sh
NODE_PATH=/workspace/setup-tools/recovery-rules/node_modules \
FIRESTORE_EMULATOR_HOST=127.0.0.1:8097 \
node tests/recovery-rules.emulator.cjs
```

The 27 scenarios cover legacy access and migration, unchanged/missing/invalid
tokens, stale revision replay, missing/noninteger/skipped revisions, documents
with only one marker, authorized token rotation, unchanged access controls, member reads,
denied listing, and owner-only permanent project deletion. The `.emulator.cjs`
suffix keeps the test separate from ordinary offline `*.test.cjs` checks.

Execution status is recorded with the validation results for this release; a
source review or JavaScript predicate test is not a Firestore emulator run.

## Validation status (2026-11-18)

The test script passes `node --check`. Java 21 and the test dependencies are
installed in the paths shown above. A real Firestore Emulator run was attempted,
but its `cloud-firestore-emulator-v1.19.8.jar` download returned **403 Domain
forbidden** under this cloud environment's network policy. Therefore the 27
emulator scenarios have **not run**, and Firestore compilation/enforcement is
not yet verified. The rules have not been deployed. Run this suite where the
emulator is available before release; do not count the source review as a pass.
