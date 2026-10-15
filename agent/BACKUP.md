# Encrypted NAS Backups

This is a read-only backup of the production Firestore database and Storage bucket.
It does not stop the network Agent or change production documents, permissions, or images.
Only the `NetworkManager` directory under the supplied backup root is used.

## Coverage And Limits

- All root collections and nested documents, including children of missing parent documents.
- Firestore typed values, including int64, timestamps, bytes, maps, arrays, and document references.
- All objects in the configured Storage bucket, including images referenced by history or trash.
- Deployment configuration: `firestore.rules`, `storage.rules`, `firestore.indexes.json`, and `firebase.json`.
- Database discovery uses one server `readTime` for every production page and collection lookup.
- Storage downloads pin each listed object generation and verify its checksum. Firestore and Storage are
  not one atomic snapshot. A referenced image missing from the listed bucket fails the backup instead
  of publishing a completed manifest. A concurrent upload may require retrying the backup.
- Firebase Authentication accounts/password hashes, IAM, credentials, and billing configuration are
  **not** backed up. Firestore `users` role profiles are included, but are not Authentication accounts.
- Original Firestore create/update system timestamps are not restored; timestamp field values are preserved.
- Images are restored without permanent download tokens, ACLs, retention policies, or bucket configuration.
- The repository remains the source of application code; retain its Git history separately.

Monthly backups imply a nominal recovery point of up to one month, longer after missed/failed runs.
Inventory may change slowly, but status history, incidents, and audit records still accumulate.
Take an additional manual backup before large imports, configuration changes, or migrations.
There is no cloud failure notification in this version; inspect private `status.json` and Task Scheduler.
No automatic retention/purge is enabled. Monitor NAS capacity and protect it with server-side snapshots
or an off-site copy. An encrypted backup is not protection against deletion of every NAS copy.

## Storage And Keys

NAS layout:

```text
NetworkManager/
  snapshot-<time>-<random>.nmbak
  objects/<hash>-<random>.nmbak
```

Keep a completed manifest **and every object it references**. Copy the complete directory for recovery.
Unchanged object generations are reused only after authenticated decryption and SHA-256 verification.
New blobs are verified before the encrypted manifest is published. `.partial` files are not completed
snapshots. Failed runs can leave unreferenced encrypted blobs; do not delete objects based only on age.
Old snapshots and damaged files are never overwritten or automatically removed.

Data uses AES-256-GCM with a random 256-bit key and a new nonce per file. Key files, manifests,
and recovery files are excluded from Git; never place them under `public/` or attach them to chat.
Encryption does not hide file counts, sizes, or manifest dates and does not prevent NAS deletion.

Private Windows runtime:

```text
%USERPROFILE%\.config\kusk-network-manager\backup\
  config.json
  backup-key.json
  status.json
  backup.log
  backup.lock
```

The installer restricts this directory to the current Windows account and SYSTEM. Administrators and
code running as this user can still access the key. Do not grant other users access to the directory.
The raw key stays outside both the repository and backup directory. The encrypted recovery-key file
may be stored separately on the NAS; this is still one physical storage failure domain.

## Installation

Requires Node.js 22+, installed `agent` dependencies, a credential file outside the repository, and an
existing writable NAS folder accessible by the signed-in Windows account. The backup uses the existing
Agent credential; no account password is stored by the installer. A separately provisioned least-privilege
backup identity should have Firestore database read and Storage object list/read permissions only.

From the repository root, use a real private credential path and school backup share:

```powershell
$env:GOOGLE_APPLICATION_CREDENTIALS = 'C:\private\agent-credentials.json'
powershell -NoProfile -File agent/install-backup-task.ps1 -BackupRoot '\\school-nas\backup' -Time '02:00' -StartNow
```

Use `-WhatIf` to preview installation without creating directories, keys, or tasks.
The installer will not overwrite a different task with the same name, nor replace an existing key.

Task `KUSK Network Backup` runs on day 1 of every month at 02:00 **Windows local time**, with sign-in catch-up.
It requires the installing Windows user to be signed in and this PC awake. It does not change sleep
settings or run before sign-in. Retries: three attempts at 30-minute intervals; maximum run: four hours.
Task Scheduler ignores overlapping task starts; the launcher also holds an exclusive runtime lock.
A successful backup covering the most recent monthly cutoff makes a sign-in run a no-op.
If the PC misses day 1, it backs up when this Windows user next signs in; it does not repeat daily.
To choose calendar quarters instead, reinstall with `-IntervalMonths 3`: January, April, July, October,
day 1 at the same time. This increases potential lost changes to three months. The installer refuses
to change a running task, preserves the existing key and snapshots, and does not force a new backup
unless `-StartNow` is supplied. `-Force` on the manual launcher bypasses the covered-period check.
The installer uses the documented [monthly Task Scheduler XML schema](https://learn.microsoft.com/en-us/windows/win32/taskschd/taskschedulerschema-daysofmonth-monthlyscheduletype-element)
instead of relying on Windows' inconsistent monthly CIM trigger property types.

After installing, protect an off-PC copy of the recovery key in an interactive local terminal:

```powershell
powershell -NoProfile -File agent/protect-backup-key.ps1 -RecoveryDirectory '\\school-nas\restricted-recovery'
```

Enter a **separate password of at least 16 characters** twice at the hidden prompts. Do not pass the
password as a command argument, environment variable, or chat message. The helper passes UTF-8 only
through a local pipe. It writes `NetworkManager-recovery-<key-id>.nmrecovery` and round-trip verifies it.
The file uses scrypt (N=131072, r=8, p=1) and AES-256-GCM. Existing recovery files are not overwritten.
Keep the password in the school's approved password vault, separate from the NAS. Losing both this
password and the local raw key makes every encrypted backup unrecoverable. Keep another protected
off-site copy of the encrypted key and backups to cover a complete NAS failure.

## Checking A Run

```powershell
Get-ScheduledTask -TaskName 'KUSK Network Backup'
Get-ScheduledTaskInfo -TaskName 'KUSK Network Backup'
$runtime = Join-Path $env:USERPROFILE '.config\kusk-network-manager\backup'
Get-Content -LiteralPath (Join-Path $runtime 'status.json')
Get-Content -LiteralPath (Join-Path $runtime 'backup.log') -Tail 20
```

Success means `phase: idle`, a recent `lastSuccessfulBackupAt`, and a completed manifest with counts.
`phase: running` is not a success; confirm the task is still running. A forced stop or machine shutdown
can leave a stale running status. `lastSuccessfulBackupAt` remains unchanged on failure. Logs contain
progress and errors, not document contents, encryption keys, or passwords, and rotate after 10 MB.

To force a manual run, wait for the task to finish, then invoke the same launcher:

```powershell
powershell -NoProfile -File agent/start-backup.ps1 -ConfigPath "$runtime\config.json" -CredentialPath $env:GOOGLE_APPLICATION_CREDENTIALS -NodePath (Get-Command node).Source -Force
```

Check NAS connectivity, disk capacity, credential access, and the log if a run fails. A corrupt prior
blob causes a fresh source copy; it is not silently reused. Do not regenerate a missing key when old
backups must remain readable. Recover the original key from its password-protected recovery file.

## Isolated Restore Drill

Run regularly, and after changing the backup implementation. Use a completed manifest, its entire
objects directory, and the correct key. Requires Firebase CLI and Java 21+. The provided config binds
Firestore and Storage to loopback and disables their UI. Do not expose emulator ports on the LAN:
emulators are not a secure production service. Use an empty demo project and a trusted local PC.
The drill loads private school data into local emulator memory/temporary storage; do not export it
to the repository, publish it, or enable public access. Stop the emulators after the test.

```powershell
firebase emulators:exec --only firestore,storage --project demo-network-restore --config firebase.test.json 'node agent/backup-cli.js restore-test --snapshot "\\school-nas\backup\NetworkManager\snapshot-<time>-<random>.nmbak" --key-file "C:\private\backup-key.json"'
```

`restore-test` accepts only loopback emulator endpoints, a `demo-` project, and empty Firestore/Storage
targets. It authenticates every backup byte before writing, refuses overwrites, remaps only typed
same-project document references, and compares restored database values and image hashes afterwards.
It returns `restore-test-passed` only on complete success. No production restore option exists.
The Firestore emulator does not support the historical REST list selector used in production, so
fixture tests use stable emulator data without a historical read selector.
Large-file checks can emit `MaxListenersExceededWarning` from the Google client's `teeny-request`
stream pipeline. These warnings are not suppressed; a run still must pass authentication, database
comparison, and image hash checks. A warning alone is not proof of corruption or of a successful restore.

Unit/integration tests (fixtures only, no production data):

```powershell
npm --prefix agent test
firebase emulators:exec --only firestore,storage --project demo-network-audit --config firebase.test.json 'npm --prefix agent run test:security'
```

## Disaster Recovery

1. Preserve the backup directory and encrypted recovery file. Verify the selected completed snapshot
   before doing anything destructive. Keep the original backup unchanged.
2. On a trusted replacement Windows PC, create a restricted private key folder outside the repository.
   Run `powershell -NoProfile -File agent/protect-backup-key.ps1 -KeyFile <new-private-key-file> -RecoveryFile <recovery-file>`.
   The helper asks for the existing password at hidden prompts and supplies stdin only. The CLI never
   accepts a password argument and refuses an existing output key file. Do not type a password into shell history.
3. Run the isolated restore drill with that recovered key. A drill using only the original local key
   proves backup readability, but not possession of the recovery password on a replacement PC.
4. Plan a separately reviewed production migration: source/target project, operator IAM, downtime,
   backup of the target, Firestore indexes/rules, Storage rules/CORS, Authentication accounts and
   matching UIDs, external references, hosting, and Agent configuration. Restore into a new/empty
   target first; this tool intentionally cannot overwrite the live database.
5. Validate counts, typed fields, image hashes, user roles and sign-in, viewer/public restrictions,
   device history/trash, and Agent heartbeat before switching users to the recovered service.

The automatic backup provides recoverable data, not unattended production disaster recovery.
Do not delete the original source or target data until a reviewed recovery is independently verified.
