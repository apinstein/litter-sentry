import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { manifest, routes } from "./litter-sentry.js";

const route = (op) => routes.find((candidate) => candidate.op === op);
assert.equal(manifest.id, "litter-robot-sentry");
assert.equal(manifest.meta.name, "Litter Sentry");
assert.ok(manifest.capabilities.imports.includes("charming:secrets/fetch@1.0"));
assert.ok(manifest.capabilities.imports.includes("charming:network/fetch@1.0"));
const values = new Map();
const storage = {
  get: async (key) => values.get(key),
  put: async (key, value) => values.set(key, structuredClone(value)),
  delete: async (key) => values.delete(key),
};

const base64url = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const idToken = `${base64url({ alg: "none" })}.${base64url({
  mid: "user-123",
  exp: Math.floor(Date.now() / 1000) + 3600,
})}.signature`;

let cleanCommands = 0;
let srpStarts = 0;
let passwordVerifierResponses = 0;
let initialSrpParameters = null;
let verifierParameters = null;
let rejectRefresh = false;
let includeStaleRobot = false;
let failLR3Load = false;
let failLR4Load = false;
let snitchPings = 0;
let lastSnitchMessage = null;
const utcTimestampWithoutZone = (date) => new Intl.DateTimeFormat("sv-SE", {
  timeZone: "UTC",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
}).format(date).replace(",", "");
// Whisker returns UTC wall-clock strings without a trailing "Z".
const lr4WallClockTimestamp = utcTimestampWithoutZone(new Date(Date.now() - 7 * 3600_000));
const fetchMock = async (url, init = {}) => {
  const body = typeof init.body === "string" && init.body.startsWith("{") ? JSON.parse(init.body) : null;
  if (url.includes("cognito-idp")) {
    if (body.AuthFlow === "REFRESH_TOKEN_AUTH" && rejectRefresh) {
      return Response.json(
        { __type: "NotAuthorizedException", message: "Refresh Token has expired" },
        { status: 400 },
      );
    }
    if (body.AuthFlow === "USER_SRP_AUTH") {
      srpStarts += 1;
      initialSrpParameters = body.AuthParameters;
      return Response.json({
        ChallengeName: "PASSWORD_VERIFIER",
        ChallengeParameters: {
          USERNAME: body.AuthParameters.USERNAME,
          USER_ID_FOR_SRP: body.AuthParameters.USERNAME,
          SRP_B: "a3f8dfe4b5c53f3a6b2f9ef3c4b7a5d1",
          SALT: "deadbeef",
          SECRET_BLOCK: Buffer.from("test-secret-block").toString("base64"),
        },
      });
    }
    if (body.ChallengeName === "PASSWORD_VERIFIER") {
      passwordVerifierResponses += 1;
      verifierParameters = body.ChallengeResponses;
      return Response.json({
        AuthenticationResult: {
          IdToken: idToken,
          AccessToken: "access-token",
          RefreshToken: "refresh-token",
          ExpiresIn: 3600,
        },
      });
    }
    return Response.json({
      AuthenticationResult: {
        IdToken: idToken,
        AccessToken: "access-token",
        RefreshToken: "refresh-token",
        ExpiresIn: 3600,
      },
    });
  }
  if (url.includes("lr4.iothings.site")) {
    if (failLR4Load) throw new Error("LR4 API unavailable");
    if (body.query.includes("GetLR4Activity")) {
      const ageHours = body.variables.serial === "LR4STALE" ? 9 : 7;
      return Response.json({
        data: {
          getLitterRobot4Activity: [
            {
              timestamp: body.variables.serial === "LR4STALE"
                ? new Date(Date.now() - ageHours * 3600_000).toISOString()
                : lr4WallClockTimestamp,
              value: "robotCycleStatusIdle",
              actionValue: null,
              stateString: "idle",
            },
          ],
        },
      });
    }
    if (body.query.includes("SendCommand")) {
      cleanCommands += 1;
      return Response.json({ data: { sendLitterRobot4Command: "Success" } });
    }
    const robots = [
      {
        unitId: "robot-1",
        name: "Downstairs",
        serial: "LR4TEST",
        isOnline: true,
        unitPowerStatus: "ON",
        robotStatus: "ROBOT_IDLE",
        robotCycleState: "CYCLE_STATE_IDLE",
        displayCode: "DC_IDLE",
        isDFIFull: false,
        DFILevelPercent: 25,
      },
      ...(includeStaleRobot ? [{
        unitId: "robot-2",
        name: "Upstairs",
        serial: "LR4STALE",
        isOnline: true,
        unitPowerStatus: "ON",
        robotStatus: "ROBOT_IDLE",
        robotCycleState: "CYCLE_STATE_IDLE",
        displayCode: "DC_IDLE",
        isDFIFull: false,
        DFILevelPercent: 25,
      }] : []),
    ];
    return Response.json({
      data: {
        getLitterRobot4ByUser: robots,
      },
    });
  }
  if (url.includes("nosnch.in")) {
    snitchPings += 1;
    lastSnitchMessage = new URLSearchParams(init.body).get("m");
    return Response.json({ ok: true });
  }
  if (url.includes("v2.api.whisker")) {
    assert.equal(init.headers["x-api-key"], "{{secret:WHISKER_V2_API_KEY}}");
    if (failLR3Load) throw new Error("LR3 API unavailable");
    return Response.json([]);
  }
  throw new Error(`Unexpected URL: ${url}`);
};

const env = {
  storage,
  fetch: fetchMock,
  log: { info() {}, warn() {}, error() {} },
};

await route("connect").handler(
  {
    username: "owner@example.com",
    password: "stored-password",
    cleanAfterHours: 6,
    alertAfterHours: 8,
    snitchUrl: "https://nosnch.in/test",
    timeZone: "America/New_York",
  },
  { env },
);

assert.equal(values.get("auth").refreshToken, "refresh-token");
assert.equal(values.get("config").password, "stored-password");
assert.equal(srpStarts, 1);
assert.equal(initialSrpParameters.PASSWORD, undefined);
assert.match(initialSrpParameters.SRP_A, /^[0-9a-f]+$/i);
assert.equal(passwordVerifierResponses, 1);
assert.equal(verifierParameters.USERNAME, "owner@example.com");
assert.ok(verifierParameters.PASSWORD_CLAIM_SIGNATURE);

failLR3Load = true;
const initialSync = await route("sync_boxes").handler({}, { env });
assert.deepEqual(initialSync.inventory.boxes, [{
  family: "LR4", id: "robot-1", serial: "LR4TEST", name: "Downstairs", apiName: "Downstairs",
}]);
assert.deepEqual(initialSync.inventory.sourceDiagnostics, [
  { source: "LR4", status: "loaded", robots: 1 },
  { source: "LR3", status: "error", error: "LR3 API unavailable" },
]);
failLR4Load = true;
const failedSync = await route("sync_boxes").handler({}, { env });
assert.deepEqual(failedSync.inventory.boxes, initialSync.inventory.boxes);
assert.deepEqual(failedSync.inventory.sourceDiagnostics, [
  { source: "LR4", status: "error", error: "LR4 API unavailable" },
  { source: "LR3", status: "error", error: "LR3 API unavailable" },
]);
failLR4Load = false;

values.set("auth", { idToken: null, refreshToken: "expired-refresh-token" });
rejectRefresh = true;
const result = await route("run_check").handler({}, { env });
assert.equal(result.robots.length, 1);
assert.ok(result.robots[0].hoursSinceLastClean > 6.8 && result.robots[0].hoursSinceLastClean < 7.2);
assert.equal(result.robots[0].cycleRequested, true);
assert.equal(result.healthy, true);
assert.equal(result.snitchPinged, true);
assert.ok(result.lastScheduledRun);
assert.equal(result.lastFailureKind, null);
assert.deepEqual(result.sourceDiagnostics, [{ source: "LR4", status: "loaded", robots: 1 }]);
assert.equal(snitchPings, 1);
assert.match(result.summary, /^==== Downstairs ====\n/);
assert.equal(lastSnitchMessage, result.summary);
assert.equal(cleanCommands, 1);
assert.equal(srpStarts, 2);
assert.equal(passwordVerifierResponses, 2);

const status = await route("status").handler({}, { env });
assert.equal(status.configured, true);
assert.equal(status.snitchConfigured, true);
assert.equal(status.snitchUrl, "https://nosnch.in/test");
assert.equal(status.timeZone, "America/New_York");
assert.equal(status.robots[0].name, "Downstairs");
assert.equal(status.robots[0].apiName, "Downstairs");
assert.equal(status.password, undefined);
assert.equal(status.totalCyclesRequested, 1);
assert.ok(status.lastCycleRequestedAt);
assert.equal(status.lastScheduledRun, result.lastScheduledRun);
assert.equal(status.scheduledCheckIntervalMs, 3600_000);

const secondCheck = await route("run_check").handler({}, { env });
assert.equal(secondCheck.totalCyclesRequested, 2);
assert.equal(cleanCommands, 2);
assert.equal(snitchPings, 2);

includeStaleRobot = true;
await route("sync_boxes").handler({}, { env });
const multiBoxCheck = await route("run_check").handler({}, { env });
assert.equal(multiBoxCheck.robots.length, 2);
assert.equal(multiBoxCheck.healthy, false);
assert.equal(multiBoxCheck.snitchPinged, false);
assert.equal(snitchPings, 2);
assert.match(multiBoxCheck.summary, /==== Downstairs ====[\s\S]*==== Upstairs ====/);

includeStaleRobot = false;
await route("sync_boxes").handler({}, { env });
const partialCheck = await route("run_check").handler({}, { env });
assert.equal(partialCheck.healthy, true);
assert.equal(partialCheck.snitchPinged, true);
assert.deepEqual(partialCheck.sourceDiagnostics, [{ source: "LR4", status: "loaded", robots: 1 }]);
assert.equal(snitchPings, 3);

await route("disconnect").handler({}, { env });
assert.equal(values.has("auth"), false);
assert.equal(values.has("config"), false);
assert.equal(values.has("status"), false);
const disconnectedStatus = await route("status").handler({}, { env });
assert.equal(disconnectedStatus.configured, false);

const ui = await readFile(new URL("./ui.js", import.meta.url), "utf8");
const backend = await readFile(new URL("./litter-sentry.js", import.meta.url), "utf8");
assert.doesNotMatch(backend, /const API_V2_KEY\s*=/);
assert.match(backend, /"x-api-key": "\{\{secret:WHISKER_V2_API_KEY\}\}"/);
const settingsViewSource = ui.slice(ui.indexOf("function settingsView"), ui.indexOf("function dashboard"));
const dashboardSource = ui.slice(ui.indexOf("function dashboard"), ui.indexOf("async function saveSettings"));
assert.match(settingsViewSource, /id="disconnect"/);
assert.doesNotMatch(dashboardSource, /id="disconnect"/);
assert.match(ui, /api\.disconnect\(\{\}\)/);
assert.match(ui, /checks recent activity and starts a cleaning cycle when a box is overdue/);
assert.match(ui, /If Sentry stops running—or it runs but a robot stays overdue—the Snitch will alert you/);
assert.match(ui, /If it is still overdue at this threshold, the dashboard flags it and the Snitch does not receive a check-in/);
assert.match(ui, /buymeacoffee\.com\/inevitable\.alan/);
assert.match(ui, /Buy me a coffee/);
assert.ok(dashboardSource.indexOf("Cycle requests") < dashboardSource.indexOf("${coffeeBlock}"));
assert.match(ui, /Litter Sentry has requested/);
assert.match(ui, /accepted by the Whisker API/);
assert.match(ui, /We haven't had to request a cycle for/);
assert.match(ui, /data-view="dashboard"/);
assert.match(ui, /data-view="settings"/);
assert.match(ui, /Connect your Whisker account to begin patrol/);
assert.match(ui, /Whisker API name/);
assert.match(ui, /value="\$\{esc\(status\.snitchUrl \|\| ""\)\}"/);
assert.match(ui, /window\.charming\.api\("litter-robot-sentry"\)/);
assert.match(ui, /Data-source diagnostics/);
assert.match(ui, /sync_boxes/);
assert.match(ui, /Sync active boxes/);
assert.match(ui, /Last sync diagnostics/);
assert.match(ui, /window\.charming\.assets\.getUrl\("litter-sentry-logo\.jpg"\)/);
assert.match(ui, /localTimeZone/);
assert.match(ui, /api\.run_check\(\{ timeZone: activeTimeZone \}\)/);
assert.match(ui, /name="timeZone"/);
assert.match(ui, /Time zone/);
assert.doesNotMatch(ui, /Date\.parse\(latestCompletedActivity\.timestamp\)/);
assert.match(ui, /alt="Litter Sentry logo"/);
assert.match(ui, /h-44 w-44/);
assert.doesNotMatch(ui, /<p class="text-xs uppercase tracking-\[0\.2em\] text-emerald-700">Litter Sentry<\/p>/);

const systemMessageSource = ui.slice(ui.indexOf("function listRobotNames"), ui.indexOf("function dashboard(status)"));
const systemMessageFor = new Function(`${systemMessageSource}\nreturn systemMessageFor;`)();
const coffeeHelperSource = ui.slice(ui.indexOf("function shouldShowCoffee"), ui.indexOf("function storedFailureKind"));
const shouldShowCoffee = new Function(`${coffeeHelperSource}\nreturn shouldShowCoffee;`)();
assert.equal(shouldShowCoffee(0), false);
assert.equal(shouldShowCoffee(1), false);
assert.equal(shouldShowCoffee(2), true);
assert.equal(shouldShowCoffee(3), true);
assert.match(ui, /const coffeeBlock = shouldShowCoffee\(cycleCount\) \?/);
assert.match(ui, /\$\{coffeeBlock\}/);
const now = Date.parse("2026-08-17T12:00:00.000Z");
const healthyRobot = { name: "Downstairs", online: true, hoursSinceLastClean: 2 };
const dashboardStatus = {
  configured: true,
  cleanAfterHours: 6,
  alertAfterHours: 8,
  scheduledCheckIntervalMs: 3600_000,
  robots: [healthyRobot],
};
const signal = (patch) => systemMessageFor({ ...dashboardStatus, ...patch }, now);

assert.deepEqual(signal({ configured: false }), {
  headline: "Litter Sentry reporting for duty.",
  explanation: "Connect your Whisker account to begin patrol.",
});
assert.equal(signal({
  lastFailureKind: "credentials_rejected",
  lastScheduledRun: "2026-08-17T00:00:00.000Z",
}).headline, "Sentry needs new orders.");
assert.equal(signal({
  lastScheduledRun: "2026-08-17T09:00:00.000Z",
  lastFailureKind: "api_unavailable",
}).headline, "Sentry missed its rounds.");
assert.match(signal({
  lastScheduledRun: "2026-08-17T11:30:00.000Z",
  lastFailureKind: "api_unavailable",
  robots: [{ ...healthyRobot, online: false }],
}).headline, /Communications are down/);
assert.equal(signal({
  lastScheduledRun: "2026-08-17T11:30:00.000Z",
  robots: [{ ...healthyRobot, online: false, hoursSinceLastClean: 10 }],
}).headline, "A sentry has gone dark.");
assert.match(signal({
  lastScheduledRun: "2026-08-17T11:30:00.000Z",
  robots: [{ ...healthyRobot, name: "Upstairs", hoursSinceLastClean: 9 }],
}).explanation, /Upstairs: exceeded the 8-hour alert threshold/);
assert.equal(signal({
  lastScheduledRun: "2026-08-17T11:30:00.000Z",
  robots: [healthyRobot, { ...healthyRobot, name: "Upstairs", hoursSinceLastClean: 7 }],
}).headline, "Not all quiet on the litter front.");
assert.equal(signal({
  lastScheduledRun: "2026-08-17T11:30:00.000Z",
  robots: [{ ...healthyRobot, cycleRequested: true }],
}).headline, "Cycle dispatched. Crisis averted.");
assert.deepEqual(signal({
  lastScheduledRun: "2026-08-17T11:30:00.000Z",
  robots: [healthyRobot],
}), {
  headline: "All’s clean on the litter front.",
  explanation: "Every box has cycled within its configured threshold.",
});
assert.match(ui, /\$\{esc\(systemMessage\.headline\)\}/);
assert.match(ui, /\$\{esc\(systemMessage\.explanation\)\}/);
assert.match(ui, /window\.charming\.onStateChange\?\.\(\(\) =>/);

console.log("Charming port tests passed");
