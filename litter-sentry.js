const COGNITO_ENDPOINT = "https://cognito-idp.us-east-1.amazonaws.com/";
const COGNITO_CLIENT_ID = "4552ujeu3aic90nf8qn53levmn";
const API_V2_ENDPOINT = "https://v2.api.whisker.iothings.site";
const LR4_ENDPOINT = "https://lr4.iothings.site/graphql";

// These keys are stored in the current user's private Charming KV namespace.
const CONFIG_KEY = "config";
const AUTH_KEY = "auth";
const STATUS_KEY = "status";
// The deployed Charming Routine invokes run_check hourly with an empty input.
const SCHEDULED_CHECK_INTERVAL_MS = 60 * 60 * 1000;
const COGNITO_POOL_NAME = "rjhNnZVAm";
const SRP_N_HEX = "FFFFFFFFFFFFFFFFC90FDAA22168C234C4C6628B80DC1CD1"
  + "29024E088A67CC74020BBEA63B139B22514A08798E3404DD"
  + "EF9519B3CD3A431B302B0A6DF25F14374FE1356D6D51C245"
  + "E485B576625E7EC6F44C42E9A637ED6B0BFF5CB6F406B7ED"
  + "EE386BFB5A899FA5AE9F24117C4B1FE649286651ECE45B3D"
  + "C2007CB8A163BF0598DA48361C55D39A69163FA8FD24CF5F"
  + "83655D23DCA3AD961C62F356208552BB9ED529077096966D"
  + "670C354E4ABC9804F1746C08CA18217C32905E462E36CE3B"
  + "E39E772C180E86039B2783A2EC07A28FB5C55DF06F4C52C9"
  + "DE2BCBF6955817183995497CEA956AE515D2261898FA0510"
  + "15728E5A8AAAC42DAD33170D04507A33A85521ABDF1CBA64"
  + "ECFB850458DBEF0A8AEA71575D060C7DB3970F85A6E1E4C7"
  + "ABF5AE8CDB0933D71E8C94E04A25619DCEE3D2261AD2EE6B"
  + "F12FFA06D98A0864D87602733EC86A64521F2B18177B200C"
  + "BBE117577A615D6C770988C0BAD946E208E24FA074E5AB31"
  + "43DB5BFCE0FD108E4B82D120A93AD2CAFFFFFFFFFFFFFFFF";
const SRP_N = BigInt(`0x${SRP_N_HEX}`);
const SRP_G = 2n;
const textEncoder = new TextEncoder();

export const manifest = {
  $schema: "https://charm.ing/schema/app-manifest/2026-07-31.json",
  // Charming keeps this manifest id stable for the existing app and its private storage.
  id: "litter-robot-sentry",
  meta: {
    name: "Litter Sentry",
    icon: { emoji: "🐈", bg: "#173a34" },
  },
  capabilities: {
    imports: [
      "charming:storage/kv@1.0",
      "charming:secrets/fetch@1.0",
      "charming:network/fetch@1.0",
      "charming:logging/emit@1.0",
    ],
  },
  permissions: {
    server: {
      fetch: [
        "https://cognito-idp.us-east-1.amazonaws.com",
        "https://v2.api.whisker.iothings.site",
        "https://lr4.iothings.site",
        "https://nosnch.in",
      ],
    },
  },
};

function decodeJwt(token) {
  const payload = token.split(".")[1];
  if (!payload) throw new Error("Whisker returned an invalid identity token");
  const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  return JSON.parse(atob(padded));
}

function tokenIsFresh(idToken) {
  try {
    return Number(decodeJwt(idToken).exp || 0) > Date.now() / 1000 + 60;
  } catch {
    return false;
  }
}

function concatBytes(...parts) {
  const result = new Uint8Array(parts.reduce((length, part) => length + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function hexToBytes(hex) {
  const normalized = hex.length % 2 === 0 ? hex : `0${hex}`;
  return Uint8Array.from({ length: normalized.length / 2 }, (_, index) =>
    Number.parseInt(normalized.slice(index * 2, index * 2 + 2), 16),
  );
}

function bytesToHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function padHex(value) {
  let hex = typeof value === "string" ? value : value.toString(16);
  if (hex.length % 2 === 1) hex = `0${hex}`;
  else if ("89abcdef".includes(hex[0].toLowerCase())) hex = `00${hex}`;
  return hex;
}

function bytesFromBase64(value) {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

function base64FromBytes(bytes) {
  return btoa(String.fromCharCode(...bytes));
}

async function sha256(bytes) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
}

async function sha256Hex(bytes) {
  return bytesToHex(await sha256(bytes));
}

async function hmacSha256(keyBytes, messageBytes) {
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, messageBytes));
}

function modPow(base, exponent, modulus) {
  let result = 1n;
  let factor = ((base % modulus) + modulus) % modulus;
  let power = exponent;
  while (power > 0n) {
    if (power & 1n) result = (result * factor) % modulus;
    factor = (factor * factor) % modulus;
    power >>= 1n;
  }
  return result;
}

function cognitoTimestamp(date = new Date()) {
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const pad = (value) => String(value).padStart(2, "0");
  return `${weekdays[date.getUTCDay()]} ${months[date.getUTCMonth()]} ${date.getUTCDate()} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())} UTC ${date.getUTCFullYear()}`;
}

async function cognitoRequest(env, target, body) {
  const response = await env.fetch(COGNITO_ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/x-amz-json-1.1",
      "x-amz-target": `AWSCognitoIdentityProviderService.${target}`,
    },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok || data.__type) {
    const kind = String(data.__type || "authentication_error").split("#").pop();
    throw new Error(`${kind}: ${data.message || "Whisker authentication failed"}`);
  }
  return data;
}

async function cognito(env, body) {
  const data = await cognitoRequest(env, "InitiateAuth", body);
  if (!data.AuthenticationResult) throw new Error("Whisker did not return authentication tokens");
  return data.AuthenticationResult;
}

function authFromResult(result, previousRefreshToken) {
  const idToken = result.IdToken;
  if (!idToken) throw new Error("Whisker did not return an identity token");
  return {
    idToken,
    accessToken: result.AccessToken || null,
    refreshToken: result.RefreshToken || previousRefreshToken || null,
    expiresAt: Date.now() + Number(result.ExpiresIn || 3600) * 1000,
    userId: decodeJwt(idToken).mid,
  };
}

async function login(env, username, password) {
  const random = new Uint8Array(128);
  crypto.getRandomValues(random);
  const smallA = BigInt(`0x${bytesToHex(random)}`);
  const largeA = modPow(SRP_G, smallA, SRP_N);
  const initialParameters = {
    USERNAME: username,
    SRP_A: largeA.toString(16),
  };
  const challenge = await cognitoRequest(env, "InitiateAuth", {
    AuthFlow: "USER_SRP_AUTH",
    ClientId: COGNITO_CLIENT_ID,
    AuthParameters: initialParameters,
  });
  if (challenge.ChallengeName !== "PASSWORD_VERIFIER") {
    throw new Error(`Whisker returned unsupported authentication challenge: ${challenge.ChallengeName || "unknown"}`);
  }

  const params = challenge.ChallengeParameters || {};
  const userIdForSrp = params.USER_ID_FOR_SRP;
  const serverB = BigInt(`0x${params.SRP_B || "0"}`);
  if (!userIdForSrp || !params.SALT || !params.SECRET_BLOCK || serverB % SRP_N === 0n) {
    throw new Error("Whisker returned an incomplete SRP authentication challenge");
  }
  const u = BigInt(`0x${await sha256Hex(hexToBytes(`${padHex(largeA)}${padHex(serverB)}`))}`);
  if (u === 0n) throw new Error("Whisker returned an invalid SRP challenge");
  const userPasswordHash = await sha256Hex(textEncoder.encode(`${COGNITO_POOL_NAME}${userIdForSrp}:${password}`));
  const x = BigInt(`0x${await sha256Hex(hexToBytes(`${padHex(params.SALT)}${userPasswordHash}`))}`);
  const k = BigInt(`0x${await sha256Hex(hexToBytes(`00${SRP_N_HEX}02`))}`);
  const sharedSecret = modPow(serverB - k * modPow(SRP_G, x, SRP_N), smallA + u * x, SRP_N);
  const salt = hexToBytes(padHex(u));
  const ikm = hexToBytes(padHex(sharedSecret));
  const prk = await hmacSha256(salt, ikm);
  const hkdf = (await hmacSha256(prk, concatBytes(textEncoder.encode("Caldera Derived Key"), Uint8Array.of(1)))).slice(0, 16);
  const timestamp = cognitoTimestamp();
  const signature = base64FromBytes(await hmacSha256(
    hkdf,
    concatBytes(
      textEncoder.encode(COGNITO_POOL_NAME),
      textEncoder.encode(userIdForSrp),
      bytesFromBase64(params.SECRET_BLOCK),
      textEncoder.encode(timestamp),
    ),
  ));
  const completed = await cognitoRequest(env, "RespondToAuthChallenge", {
    ClientId: COGNITO_CLIENT_ID,
    ChallengeName: "PASSWORD_VERIFIER",
    ChallengeResponses: {
      USERNAME: params.USERNAME || initialParameters.USERNAME,
      TIMESTAMP: timestamp,
      PASSWORD_CLAIM_SECRET_BLOCK: params.SECRET_BLOCK,
      PASSWORD_CLAIM_SIGNATURE: signature,
    },
  });
  if (!completed.AuthenticationResult) throw new Error("Whisker did not complete SRP authentication");
  return authFromResult(completed.AuthenticationResult);
}

async function validAuth(env) {
  const stored = await env.storage.get(AUTH_KEY);
  const config = await env.storage.get(CONFIG_KEY);
  if (!config?.username || !config?.password) {
    throw new Error("Litter Robot account is not connected");
  }
  if (stored?.idToken && tokenIsFresh(stored.idToken)) return stored;

  if (stored?.refreshToken) {
    try {
      const result = await cognito(env, {
        AuthFlow: "REFRESH_TOKEN_AUTH",
        ClientId: COGNITO_CLIENT_ID,
        AuthParameters: { REFRESH_TOKEN: stored.refreshToken },
      });
      const refreshed = authFromResult(result, stored.refreshToken);
      await env.storage.put(AUTH_KEY, refreshed);
      return refreshed;
    } catch (error) {
      env.log.warn(`Whisker refresh token rejected; signing in with stored credentials: ${error.message || error}`);
    }
  }

  const reauthenticated = await login(env, config.username, config.password);
  if (!reauthenticated.refreshToken) throw new Error("Whisker did not issue a refresh token");
  await env.storage.put(AUTH_KEY, reauthenticated);
  return reauthenticated;
}

async function whiskerFetch(env, auth, url, init = {}) {
  const response = await env.fetch(url, {
    ...init,
    headers: {
      authorization: `Bearer ${auth.idToken}`,
      "content-type": "application/json",
      ...(url.startsWith(API_V2_ENDPOINT) ? { "x-api-key": "{{secret:WHISKER_V2_API_KEY}}" } : {}),
      ...(init.headers || {}),
    },
  });
  const data = await response.json();
  if (!response.ok || data?.errors?.length) {
    const detail = data?.errors?.map((e) => e.message).join(", ") || data?.message || response.statusText;
    throw new Error(`Whisker API ${response.status}: ${detail}`);
  }
  return data;
}

const LR4_ROBOTS_QUERY = `
  query GetLR4($userId: String!) {
    getLitterRobot4ByUser(userId: $userId) {
      unitId name serial isOnline unitPowerStatus robotStatus robotCycleState
      displayCode isDFIFull DFILevelPercent lastSeen
    }
  }
`;

const LR4_ACTIVITY_QUERY = `
  query GetLR4Activity($serial: String!, $limit: Int, $consumer: String) {
    getLitterRobot4Activity(serial: $serial, limit: $limit, consumer: $consumer) {
      timestamp value actionValue stateString
    }
  }
`;

const LR4_CLEAN_MUTATION = `
  mutation SendCommand($serial: String!, $command: String!, $commandSource: String) {
    sendLitterRobot4Command(input: {
      serial: $serial, command: $command, commandSource: $commandSource
    })
  }
`;

async function graphql(env, auth, query, variables) {
  return whiskerFetch(env, auth, LR4_ENDPOINT, {
    method: "POST",
    body: JSON.stringify({ query, variables }),
  });
}

function activityLabel(activity) {
  const labels = {
    robotCycleStatusIdle: "CLEAN_CYCLE_COMPLETE",
    robotCycleStatusDump: "CLEAN_CYCLE",
    robotStatusCatDetect: "CAT_DETECTED",
    robotCycleStateCatDetect: "CAT_SENSOR_INTERRUPTED",
    DFIFullFlagOn: "DRAWER_FULL",
    bonnetRemovedYes: "BONNET_REMOVED",
    catWeight: "PET_WEIGHT_RECORDED",
  };
  return labels[activity.value] || activity.unitStatus || activity.stateString || activity.value || "UNKNOWN";
}

function normalizedActivity(activity) {
  const millis = timestampMillis(activity.timestamp);
  return {
    // Whisker activity values are UTC even when the API omits the trailing Z.
    timestamp: Number.isFinite(millis) ? new Date(millis).toISOString() : activity.timestamp,
    action: activityLabel(activity),
    detail: activity.actionValue ?? null,
  };
}

function timestampMillis(timestamp, timeZone) {
  const value = String(timestamp || "");
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(value)) return Date.parse(value);
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!match) return Date.parse(value);
  const [, year, month, day, hour, minute, second] = match;
  const wallClockAsUtc = Date.UTC(year, Number(month) - 1, day, hour, minute, second);
  return wallClockAsUtc;
}

function lastCleanTime(activities, timeZone) {
  const clean = activities
    .filter((a) => activityLabel(a) === "CLEAN_CYCLE_COMPLETE")
    .map((a) => timestampMillis(a.timestamp, timeZone))
    .filter(Number.isFinite);
  return clean.length ? Math.max(...clean) : null;
}

async function loadLR4(env, auth, timeZone) {
  const result = await graphql(env, auth, LR4_ROBOTS_QUERY, { userId: auth.userId });
  const robots = result?.data?.getLitterRobot4ByUser || [];
  return Promise.all(
    robots.map(async (robot) => {
      const history = await graphql(env, auth, LR4_ACTIVITY_QUERY, {
        serial: robot.serial,
        limit: 25,
        consumer: "app",
      });
      const activities = history?.data?.getLitterRobot4Activity || [];
      return {
        family: "LR4",
        id: String(robot.unitId),
        serial: robot.serial,
        name: robot.name || robot.serial,
        apiName: robot.name || null,
        online: robot.isOnline === true,
        status: robot.robotStatus,
        drawerLevel: robot.DFILevelPercent ?? null,
        raw: robot,
        activities,
        lastCleanAt: lastCleanTime(activities, timeZone),
      };
    }),
  );
}

async function loadLR3(env, auth, timeZone) {
  const robots = await whiskerFetch(
    env,
    auth,
    `${API_V2_ENDPOINT}/users/${encodeURIComponent(auth.userId)}/robots`,
  );
  if (!Array.isArray(robots)) return [];
  return Promise.all(
    robots.map(async (robot) => {
      const id = String(robot.litterRobotId);
      const activity = await whiskerFetch(
        env,
        auth,
        `${API_V2_ENDPOINT}/users/${encodeURIComponent(auth.userId)}/robots/${encodeURIComponent(id)}/activity?limit=25`,
      );
      const activities = activity?.activities || [];
      return {
        family: "LR3",
        id,
        serial: robot.litterRobotSerial,
        name: robot.litterRobotNickname || robot.litterRobotSerial,
        apiName: robot.litterRobotNickname || null,
        online: robot.powerStatus !== "NC" && robot.unitStatus !== "OFFLINE",
        status: robot.unitStatus,
        drawerLevel: null,
        raw: robot,
        activities,
        lastCleanAt: lastCleanTime(activities, timeZone),
      };
    }),
  );
}

const SOURCE_LOADERS = { LR4: loadLR4, LR3: loadLR3 };

function compactRobot(robot) {
  return {
    family: robot.family,
    id: robot.id,
    serial: robot.serial,
    name: robot.name,
    apiName: robot.apiName,
  };
}

function uniqueRobots(robots) {
  return [...new Map(robots.map((robot) => [`${robot.family}:${robot.serial}`, robot])).values()];
}

async function loadSources(env, auth, sources, timeZone) {
  const results = await Promise.allSettled(sources.map((source) => SOURCE_LOADERS[source](env, auth, timeZone)));
  const sourceDiagnostics = results.map((result, index) => {
    const source = sources[index];
    return result.status === "fulfilled"
      ? { source, status: "loaded", robots: result.value.length }
      : { source, status: "error", error: result.reason?.message || String(result.reason) };
  });
  return {
    sourceDiagnostics,
    robots: uniqueRobots(results.flatMap((result) => result.status === "fulfilled" ? result.value : [])),
  };
}

function sourceErrors(sourceDiagnostics) {
  return sourceDiagnostics
    .filter((diagnostic) => diagnostic.status === "error")
    .map((diagnostic) => `${diagnostic.source} API: ${diagnostic.error}`);
}

function updateInventory(previousInventory, discovery, syncedAt) {
  const priorBoxes = previousInventory?.boxes || [];
  const boxes = ["LR4", "LR3"].flatMap((source) => {
    const diagnostic = discovery.sourceDiagnostics.find((item) => item.source === source);
    if (diagnostic?.status === "loaded") {
      return discovery.robots.filter((robot) => robot.family === source).map(compactRobot);
    }
    return priorBoxes.filter((robot) => robot.family === source);
  });
  return {
    syncedAt,
    boxes: uniqueRobots(boxes).map(compactRobot),
    sourceDiagnostics: discovery.sourceDiagnostics,
  };
}

async function loadKnownRobots(env, auth, inventory, timeZone) {
  const knownBoxes = inventory?.boxes || [];
  if (!knownBoxes.length) throw new Error("No active boxes are saved. Sync active boxes in Settings first.");
  const sources = [...new Set(knownBoxes.map((robot) => robot.family))];
  const discovery = await loadSources(env, auth, sources, timeZone);
  const knownKeys = new Set(knownBoxes.map((robot) => `${robot.family}:${robot.serial}`));
  const robots = discovery.robots.filter((robot) => knownKeys.has(`${robot.family}:${robot.serial}`));
  const returnedKeys = new Set(robots.map((robot) => `${robot.family}:${robot.serial}`));
  const missing = knownBoxes.filter((robot) => !returnedKeys.has(`${robot.family}:${robot.serial}`));
  return { ...discovery, robots, missing };
}

async function startCleaning(env, auth, robot) {
  if (robot.family === "LR4") {
    const result = await graphql(env, auth, LR4_CLEAN_MUTATION, {
      serial: robot.serial,
      command: "cleanCycle",
      commandSource: "app",
    });
    const value = result?.data?.sendLitterRobot4Command;
    if (String(value || "").includes("Error")) throw new Error(String(value));
    return true;
  }

  await whiskerFetch(
    env,
    auth,
    `${API_V2_ENDPOINT}/users/${encodeURIComponent(auth.userId)}/robots/${encodeURIComponent(robot.id)}/dispatch-commands`,
    { method: "POST", body: JSON.stringify({ command: "<C" }) },
  );
  return true;
}

function hoursSince(timestamp) {
  return timestamp == null ? null : Math.max(0, (Date.now() - timestamp) / 3_600_000);
}

async function pingSnitch(env, url, message) {
  if (!url) return false;
  const response = await env.fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ m: message }).toString(),
  });
  if (!response.ok) throw new Error(`Dead Man's Snitch returned HTTP ${response.status}`);
  return true;
}

function publicStatus(config, stored) {
  return {
    configured: Boolean(config && stored?.connected),
    account: config?.username || null,
    cleanAfterHours: config?.cleanAfterHours ?? 6,
    alertAfterHours: config?.alertAfterHours ?? 8,
    snitchConfigured: Boolean(config?.snitchUrl),
    snitchUrl: config?.snitchUrl || null,
    timeZone: config?.timeZone || null,
    lastRun: stored?.lastRun || null,
    lastScheduledRun: stored?.lastScheduledRun || null,
    scheduledCheckIntervalMs: SCHEDULED_CHECK_INTERVAL_MS,
    lastError: stored?.lastError || null,
    lastFailureKind: stored?.lastFailureKind || null,
    sourceDiagnostics: stored?.sourceDiagnostics || [],
    inventory: stored?.inventory || null,
    totalCyclesRequested: Number.isFinite(stored?.totalCyclesRequested) ? stored.totalCyclesRequested : 0,
    lastCycleRequestedAt: stored?.lastCycleRequestedAt || null,
    robots: stored?.robots || [],
    summary: stored?.summary || null,
  };
}

function failureKind(message) {
  const text = String(message || "");
  if (/(NotAuthorizedException|authentication|identity token|password|refresh token)/i.test(text)) {
    return "credentials_rejected";
  }
  if (/(Whisker API|API unavailable|fetch failed|network|timed? out|ECONN|ENOTFOUND)/i.test(text)) {
    return "api_unavailable";
  }
  return "check_failed";
}

export const routes = [
  {
    op: "status",
    method: "GET",
    annotations: { readOnlyHint: true },
    outputSchema: { type: "object" },
    handler: async (input, { env }) => {
      const config = await env.storage.get(CONFIG_KEY);
      const status = await env.storage.get(STATUS_KEY);
      return publicStatus(config, status);
    },
  },
  {
    op: "connect",
    method: "POST",
    inputSchema: {
      type: "object",
      required: ["username", "password"],
      properties: {
        username: { type: "string", minLength: 3 },
        password: { type: "string", minLength: 1 },
        cleanAfterHours: { type: "number", minimum: 1, maximum: 48 },
        alertAfterHours: { type: "number", minimum: 1, maximum: 72 },
        snitchUrl: { type: "string" },
        timeZone: { type: "string", minLength: 1, maxLength: 64 },
      },
      additionalProperties: false,
    },
    outputSchema: { type: "object" },
    handler: async (input, { env }) => {
      let auth;
      try {
        auth = await login(env, input.username.trim(), input.password);
      } catch (error) {
        const message = error.message || String(error);
        env.log.warn(`Whisker sign-in failed: ${message}`);
        return { connected: false, error: `Whisker sign-in failed: ${message}` };
      }
      if (!auth.refreshToken) throw new Error("Whisker did not issue a refresh token");
      const config = {
        username: input.username.trim(),
        password: input.password,
        cleanAfterHours: input.cleanAfterHours ?? 6,
        alertAfterHours: input.alertAfterHours ?? 8,
        snitchUrl: input.snitchUrl?.trim() || null,
        timeZone: input.timeZone?.trim() || null,
      };
      await env.storage.put(AUTH_KEY, auth);
      await env.storage.put(CONFIG_KEY, config);
      await env.storage.put(STATUS_KEY, {
        connected: true,
        lastRun: null,
        totalCyclesRequested: 0,
        lastCycleRequestedAt: null,
        inventory: null,
        robots: [],
      });
      env.log.info("Litter Robot account connected; credentials retained in private app storage for reauthentication");
      return { connected: true, account: config.username };
    },
  },
  {
    op: "configure",
    method: "POST",
    inputSchema: {
      type: "object",
      properties: {
        cleanAfterHours: { type: "number", minimum: 1, maximum: 48 },
        alertAfterHours: { type: "number", minimum: 1, maximum: 72 },
        snitchUrl: { type: "string" },
        timeZone: { type: "string", minLength: 1, maxLength: 64 },
      },
      additionalProperties: false,
    },
    outputSchema: { type: "object" },
    handler: async (input, { env }) => {
      const current = (await env.storage.get(CONFIG_KEY)) || {};
      const next = {
        ...current,
        ...(input.cleanAfterHours == null ? {} : { cleanAfterHours: input.cleanAfterHours }),
        ...(input.alertAfterHours == null ? {} : { alertAfterHours: input.alertAfterHours }),
        ...(input.snitchUrl == null ? {} : { snitchUrl: input.snitchUrl.trim() || null }),
        ...(input.timeZone == null ? {} : { timeZone: input.timeZone.trim() || null }),
      };
      if ((next.alertAfterHours ?? 8) < (next.cleanAfterHours ?? 6)) {
        throw new Error("Alert threshold must be at least the cleaning threshold");
      }
      await env.storage.put(CONFIG_KEY, next);
      return { saved: true };
    },
  },
  {
    op: "sync_boxes",
    method: "POST",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    outputSchema: { type: "object" },
    handler: async (_input, { env }) => {
      const config = await env.storage.get(CONFIG_KEY);
      if (!config) throw new Error("Litter Robot account is not connected");
      const auth = await validAuth(env);
      const discovery = await loadSources(env, auth, ["LR4", "LR3"], config.timeZone);
      const previousStatus = (await env.storage.get(STATUS_KEY)) || { connected: true, robots: [] };
      const inventory = updateInventory(previousStatus.inventory, discovery, new Date().toISOString());
      await env.storage.put(STATUS_KEY, { ...previousStatus, connected: true, inventory });
      env.log.info(`Litter Robot box inventory synced: boxes=${inventory.boxes.length}`);
      return { inventory };
    },
  },
  {
    op: "run_check",
    method: "POST",
    inputSchema: {
      type: "object",
      properties: { timeZone: { type: "string", minLength: 1, maxLength: 64 } },
      additionalProperties: false,
    },
    outputSchema: { type: "object" },
    handler: async (input, { env }) => {
      let config = await env.storage.get(CONFIG_KEY);
      if (!config) throw new Error("Litter Robot account is not connected");
      if (input.timeZone?.trim() && config.timeZone !== input.timeZone.trim()) {
        config = { ...config, timeZone: input.timeZone.trim() };
        await env.storage.put(CONFIG_KEY, config);
      }
      const startedAt = new Date().toISOString();
      const isScheduledRun = !input.timeZone?.trim();
      const previousStatus = await env.storage.get(STATUS_KEY);

      try {
        const auth = await validAuth(env);
        const { sourceDiagnostics, robots, missing } = await loadKnownRobots(env, auth, previousStatus.inventory, config.timeZone);
        const loadErrors = sourceErrors(sourceDiagnostics);
        const missingErrors = missing.map((robot) => `Expected ${robot.family} box ${robot.name || robot.serial} was not returned`);
        if (!robots.length) {
          throw new Error([...loadErrors, ...missingErrors].join("; ") || "No saved Litter Robot boxes found");
        }

        const results = [];
        for (const robot of robots) {
          const ageHours = hoursSince(robot.lastCleanAt);
          let cycleRequested = false;
          let cycleError = null;
          if (ageHours == null || ageHours > config.cleanAfterHours) {
            try {
              cycleRequested = await startCleaning(env, auth, robot);
            } catch (error) {
              cycleError = error.message || String(error);
            }
          }
          results.push({
            family: robot.family,
            id: robot.id,
            serial: robot.serial,
            name: robot.name,
            apiName: robot.apiName,
            online: robot.online,
            status: robot.status,
            drawerLevel: robot.drawerLevel,
            lastCleanAt: robot.lastCleanAt == null ? null : new Date(robot.lastCleanAt).toISOString(),
            hoursSinceLastClean: ageHours == null ? null : Math.round(ageHours * 100) / 100,
            cycleRequested,
            cycleError,
            activities: robot.activities.slice(0, 10).map(normalizedActivity),
          });
        }

        const allErrors = [...loadErrors, ...missingErrors];
        const lastError = allErrors.length
          ? `Some Litter Robot data could not be loaded: ${allErrors.join("; ")}`
          : null;
        const lastFailureKind = lastError ? failureKind(lastError) : null;
        const healthy = allErrors.length === 0 && results.every((robot) =>
          robot.online
          && robot.cycleError == null
          && robot.hoursSinceLastClean != null
          && robot.hoursSinceLastClean <= config.alertAfterHours,
        );
        const cyclesRequestedThisRun = results.filter((r) => r.cycleRequested).length;
        const totalCyclesRequested = (Number.isFinite(previousStatus?.totalCyclesRequested)
          ? previousStatus.totalCyclesRequested
          : 0) + cyclesRequestedThisRun;
        const robotSummary = results.map((robot) => [
          `==== ${robot.name} ====`,
          `Family: ${robot.family}`,
          `Status: ${robot.status || "unknown"}`,
          `Online: ${robot.online ? "yes" : "no"}`,
          `Last completed cycle: ${robot.lastCleanAt || "unknown"} (${robot.hoursSinceLastClean ?? "unknown"}h ago)`,
          `Cycle request: ${robot.cycleRequested ? "accepted" : "not needed"}`,
          ...(robot.cycleError ? [`Cycle request error: ${robot.cycleError}`] : []),
        ].join("\n"));
        const summary = [
          ...robotSummary,
          ...(lastError ? [`==== Sentry warning ====\n${lastError}`] : []),
        ].join("\n\n");
        const snitchPinged = healthy ? await pingSnitch(env, config.snitchUrl, summary) : false;

        const stored = {
          connected: true,
          lastRun: startedAt,
          lastScheduledRun: isScheduledRun ? startedAt : previousStatus?.lastScheduledRun || null,
          lastError,
          lastFailureKind,
          sourceDiagnostics,
          inventory: previousStatus.inventory,
          totalCyclesRequested,
          lastCycleRequestedAt: cyclesRequestedThisRun ? startedAt : previousStatus?.lastCycleRequestedAt || null,
          healthy,
          snitchPinged,
          robots: results,
          summary,
        };
        await env.storage.put(STATUS_KEY, stored);
        env.log.info(`Litter Robot check complete: healthy=${healthy}, robots=${results.length}, cyclesRequested=${cyclesRequestedThisRun}`);
        return stored;
      } catch (error) {
        const message = error.message || String(error);
        const prior = (await env.storage.get(STATUS_KEY)) || { connected: true, robots: [] };
        await env.storage.put(STATUS_KEY, {
          ...prior,
          lastRun: startedAt,
          lastScheduledRun: isScheduledRun ? startedAt : prior.lastScheduledRun || null,
          lastError: message,
          lastFailureKind: failureKind(message),
        });
        env.log.error(`Litter Robot check failed: ${message}`);
        throw error;
      }
    },
  },
  {
    op: "disconnect",
    method: "POST",
    annotations: { destructiveHint: true },
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    outputSchema: { type: "object" },
    handler: async (_input, { env }) => {
      await env.storage.delete(AUTH_KEY);
      await env.storage.delete(CONFIG_KEY);
      await env.storage.delete(STATUS_KEY);
      return { disconnected: true };
    },
  },
];
