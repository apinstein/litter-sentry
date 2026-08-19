# Charming port

This directory contains the Charming implementation of Litter Sentry: a small private caretaker for Whisker-connected Litter-Robot units. On each check, it reviews recent activity, starts a cleaning cycle once a box has waited beyond the chosen threshold, and shows the outcome in a simple dashboard.

## Runtime design

- The initial `connect` operation authenticates with Whisker's AWS Cognito SRP challenge flow, matching the existing AWS implementation.
- The username/password and returned tokens are retained in private Charming KV storage. The password is never exposed by the app API or logs.
- The dashboard shows the connected account and lets its owner disconnect it at any time, which removes the saved credentials, tokens, and prior check history before returning to the connection screen.
- The dashboard retains a private, per-app count of cleaning-cycle requests the Whisker API accepted, along with the time of the most recent one. It deliberately says “requested,” because the cloud accepts the command before the app can independently confirm the physical cycle completed.
- Setup and **Sync active boxes** enumerate the LR3 and LR4 APIs and save the boxes found. Scheduled or manual `run_check` calls only the API families for those saved boxes; it does not discover new hardware in the background. A sync failure preserves previously saved boxes for that source.
- `run_check` refreshes authentication when possible, then automatically signs in again with the stored username/password if Whisker rejects the refresh token. It starts a clean cycle after the configured threshold, and pings Dead Man's Snitch only after every saved box is online, returned by its expected API, free of cycle-request errors, and inside the alert threshold.
- Dead Man's Snitch is an optional backup layer. Its expected check-in schedule must match the `run_check` Routine cadence: Sentry only pings it after a successful check when every robot has cycled within the alert threshold. A missing ping therefore signals either that Sentry did not run or that a robot remained overdue.

## Required Charming Routine

After deploying the app, create an **hourly** Charming Routine for the `run_check` operation. The Routine invokes `run_check` with empty input and is what makes monitoring and automatic cycle requests happen without someone keeping the app open. The user can still run a check manually with **Run check now**.

If Dead Man's Snitch is configured, set its expected check-in cadence to hourly as well. Do not schedule `connect`, `sync_boxes`, or `disconnect`: those are owner-initiated setup and account-management operations.

## Required Charming Secret for LR3

If the account has an LR3, set the `WHISKER_V2_API_KEY` secret in the app's **Settings → Secrets** before syncing or running checks. Litter Sentry sends this secret only as the server-side `x-api-key` header for Whisker's LR3/V2 API; the value is not in this repository or app storage. LR4-only accounts do not use this secret.

## Charming files

- `litter-sentry.js`: backend module and routes.
- `ui.js`: inline Charming UI program.

The app is intended to remain private because its KV storage contains Whisker credentials and tokens and, optionally, a Dead Man's Snitch URL.

Litter Sentry is an independent app and is not affiliated with or endorsed by Whisker or Litter-Robot.
