const api = window.charming.api("litter-robot-sentry");
const root = document.getElementById("app");
const logoUrl = window.charming.assets.getUrl("litter-sentry-logo.jpg");
const localTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
let activeTimeZone = localTimeZone;
let currentView = "dashboard";

const esc = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");

function ageLabel(hours) {
  if (hours == null) return "No completed cycle found";
  if (hours < 1) return `${Math.round(hours * 60)} minutes ago`;
  return `${hours.toFixed(1)} hours ago`;
}

function formatTimestamp(timestamp) {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return String(timestamp);
  try {
    return new Intl.DateTimeFormat(undefined, {
      timeZone: activeTimeZone,
      dateStyle: "short",
      timeStyle: "medium",
    }).format(date);
  } catch {
    return date.toLocaleString();
  }
}

function robotCard(robot, alertAfterHours) {
  const displayedHoursSinceClean = robot.hoursSinceLastClean;
  const stale = displayedHoursSinceClean == null || displayedHoursSinceClean > alertAfterHours;
  const events = (robot.activities || []).slice(0, 6).map((activity) => `
    <li class="flex justify-between gap-4 py-2 border-b border-slate-100 last:border-0">
      <span class="font-medium text-slate-700">${esc(activity.action)}</span>
      <time class="text-slate-400 text-xs whitespace-nowrap">${esc(formatTimestamp(activity.timestamp))}</time>
    </li>`).join("");
  return `
    <article class="rounded-2xl bg-white border border-slate-200 shadow-sm overflow-hidden">
      <div class="p-5 flex items-start justify-between gap-4">
        <div>
          <p class="text-xs uppercase tracking-[0.18em] text-slate-400">${esc(robot.family)} · ${esc(robot.status)}</p>
          ${robot.apiName ? '<p class="text-xs font-medium text-slate-400 mt-2">Whisker API name</p>' : ""}
          <h2 class="text-xl font-semibold text-slate-900 mt-1">${esc(robot.name)}</h2>
          <p class="mt-2 ${stale ? "text-amber-700" : "text-emerald-700"}">${esc(ageLabel(displayedHoursSinceClean))}</p>
        </div>
        <span class="h-3 w-3 rounded-full mt-2 ${robot.online ? "bg-emerald-500" : "bg-rose-500"}" title="${robot.online ? "Online" : "Offline"}"></span>
      </div>
      ${robot.cycleRequested ? '<div class="mx-5 mb-4 rounded-lg bg-blue-50 text-blue-800 px-3 py-2 text-sm">A cleaning cycle was requested.</div>' : ""}
      ${robot.cycleError ? `<div class="mx-5 mb-4 rounded-lg bg-rose-50 text-rose-800 px-3 py-2 text-sm">${esc(robot.cycleError)}</div>` : ""}
      <div class="bg-slate-50 px-5 py-3">
        <p class="text-xs uppercase tracking-[0.16em] text-slate-400 mb-1">Recent activity</p>
        <ul>${events || '<li class="py-2 text-slate-400">No activity returned</li>'}</ul>
      </div>
    </article>`;
}

function navigation(activeView) {
  const buttonClass = (view) => activeView === view
    ? "bg-[#173a34] text-white shadow-sm"
    : "bg-white text-slate-600 hover:bg-slate-50";
  return `
    <nav class="flex justify-end mb-10" aria-label="Main navigation">
      <div class="flex rounded-xl border border-slate-200 bg-slate-100 p-1" role="tablist" aria-label="Sentry pages">
        <button type="button" data-view="dashboard" class="rounded-lg px-3 py-2 text-sm font-medium transition ${buttonClass("dashboard")}">Dashboard</button>
        <button type="button" data-view="settings" class="rounded-lg px-3 py-2 text-sm font-medium transition ${buttonClass("settings")}">Settings</button>
      </div>
    </nav>`;
}

function attachNavigation() {
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => {
      currentView = button.dataset.view;
      render();
    });
  });
}

function settingsView(status) {
  const canConnect = window.charming.viewer.can("connect");
  const canConfigure = window.charming.viewer.can("configure");
  const canDisconnect = window.charming.viewer.can("disconnect");
  const canSync = window.charming.viewer.can("sync_boxes");
  if (status.configured) {
    const inventory = status.inventory;
    const boxNames = (inventory?.boxes || []).map((box) => box.apiName || box.name || box.serial);
    const inventoryText = boxNames.length ? boxNames.join(", ") : "No active boxes have been saved yet.";
    const syncErrors = (inventory?.sourceDiagnostics || []).filter((diagnostic) => diagnostic.status === "error");
    const syncDiagnostics = (inventory?.sourceDiagnostics || []).map((diagnostic) => diagnostic.status === "loaded"
      ? `<li><strong>${esc(diagnostic.source)} API:</strong> loaded ${esc(diagnostic.robots)} ${diagnostic.robots === 1 ? "box" : "boxes"}</li>`
      : `<li><strong>${esc(diagnostic.source)} API:</strong> ${esc(diagnostic.error)}</li>`).join("");
    root.innerHTML = `
      <main class="min-h-screen bg-[#f3f5f1] text-slate-900 p-5 sm:p-8">
        <div class="max-w-5xl mx-auto">${navigation("settings")}
          <section class="max-w-xl mx-auto rounded-3xl bg-white border border-slate-200 shadow-sm p-6 sm:p-8">
            <p class="text-xs uppercase tracking-[0.2em] text-emerald-700">Settings</p>
            <h1 class="text-3xl font-semibold tracking-tight mt-2">How Sentry watches the boxes</h1>
            <p class="text-slate-500 mt-3">Connected as ${esc(status.account)}. Update the thresholds and Dead Man's Snitch URL below.</p>
            <form id="settings-form" class="mt-7 space-y-5">
              <div class="grid grid-cols-2 gap-3">
                <label><span class="text-sm font-medium">Clean after</span><span class="block text-xs text-slate-500 mt-1 leading-relaxed">Sentry requests a clean once a box is overdue.</span><div class="relative mt-2"><input name="cleanAfterHours" type="number" min="1" max="48" value="${esc(status.cleanAfterHours)}" class="w-full rounded-xl border border-slate-300 px-3 py-2.5 pr-12 bg-white"><span class="absolute right-3 top-2.5 text-slate-400">hrs</span></div></label>
                <label><span class="text-sm font-medium">Alert after</span><span class="block text-xs text-slate-500 mt-1 leading-relaxed">An overdue robot prevents a Snitch check-in.</span><div class="relative mt-2"><input name="alertAfterHours" type="number" min="1" max="72" value="${esc(status.alertAfterHours)}" class="w-full rounded-xl border border-slate-300 px-3 py-2.5 pr-12 bg-white"><span class="absolute right-3 top-2.5 text-slate-400">hrs</span></div></label>
              </div>
              <label class="block"><span class="text-sm font-medium">Dead Man's Snitch URL <span class="font-normal text-slate-400">(optional)</span></span><span class="block text-xs text-slate-500 mt-1 leading-relaxed">The endpoint Sentry checks in with after a healthy run. Clear it to disable the backup check-in.</span><input name="snitchUrl" type="url" value="${esc(status.snitchUrl || "")}" placeholder="https://nosnch.in/..." class="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2.5 bg-white"></label>
              <label class="block"><span class="text-sm font-medium">Time zone</span><span class="block text-xs text-slate-500 mt-1 leading-relaxed">Used to display activity times. Detected from this browser by default.</span><input name="timeZone" type="text" required value="${esc(status.timeZone || localTimeZone)}" class="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2.5 bg-white"></label>
              <button ${canConfigure ? "" : "disabled"} class="w-full rounded-xl bg-[#173a34] text-white font-medium py-3 hover:bg-[#214c44] disabled:opacity-50">${canConfigure ? "Save settings" : "Read-only access"}</button>
              <p id="settings-error" class="text-sm text-rose-700 min-h-5"></p>
            </form>
            <section class="mt-8 pt-6 border-t border-slate-200">
              <p class="text-sm font-medium text-slate-800">Active boxes</p>
              <p class="text-sm text-slate-500 mt-1">${esc(inventoryText)}</p>
              <p class="text-xs text-slate-400 mt-1">${inventory?.syncedAt ? `Last synced ${esc(new Date(inventory.syncedAt).toLocaleString())}` : "Sync your box list to choose what Sentry checks."}</p>
              ${syncErrors.length ? `<p class="text-xs text-amber-700 mt-2">Some box sources could not be reached during the last sync: ${esc(syncErrors.map((diagnostic) => diagnostic.source).join(", "))}.</p>` : ""}
              <button id="sync-boxes" ${canSync ? "" : "disabled"} class="mt-3 rounded-xl border border-slate-300 bg-white text-slate-700 font-medium px-4 py-2.5 hover:bg-slate-50 disabled:opacity-50">${canSync ? "Sync active boxes" : "Read-only access"}</button>
              <p id="sync-error" class="text-sm text-rose-700 min-h-5 mt-2"></p>
              ${syncDiagnostics ? `<div class="mt-3 rounded-xl bg-slate-50 border border-slate-200 px-4 py-3 text-sm text-slate-700"><p class="font-medium text-slate-800">Last sync diagnostics</p><ul class="mt-2 space-y-1">${syncDiagnostics}</ul></div>` : ""}
            </section>
            <div class="mt-8 pt-6 border-t border-slate-200"><p class="text-sm text-slate-500">Want to use a different Whisker account?</p><button id="disconnect" ${canDisconnect ? "" : "disabled"} class="mt-3 rounded-xl border border-slate-300 bg-white text-slate-700 font-medium px-4 py-2.5 hover:bg-slate-50 disabled:opacity-50">Disconnect account</button></div>
          </section>
        </div>
      </main>`;
    attachNavigation();
    if (canConfigure) document.getElementById("settings-form").addEventListener("submit", saveSettings);
    if (canSync) document.getElementById("sync-boxes").addEventListener("click", syncBoxes);
    if (canDisconnect) document.getElementById("disconnect").addEventListener("click", disconnect);
    return;
  }
  root.innerHTML = `
    <main class="min-h-screen bg-[#f3f5f1] text-slate-900 p-5 sm:p-8">
      <div class="max-w-5xl mx-auto">${navigation("settings")}
      <section class="max-w-xl mx-auto rounded-3xl bg-white border border-slate-200 shadow-sm p-6 sm:p-8">
        <img src="${logoUrl}" alt="Litter Sentry logo" class="h-44 w-44 object-contain mb-6">
        <h1 class="text-3xl font-semibold tracking-tight">Connect your Whisker account</h1>
        <p class="text-slate-500 mt-3 leading-relaxed">Litter Sentry is a small caretaker for your cats' boxes: when you run a check, it checks recent activity and starts a cleaning cycle when a box is overdue. It also gives you a simple dashboard of the last check, recent activity, and any problem that needs your attention.</p>
        <p class="text-slate-500 mt-3 leading-relaxed">Your Whisker credentials and refresh token stay in this private app's storage so future checks can sign in again automatically if a refresh token expires.</p>
        <form id="connect-form" class="mt-7 space-y-4">
          <label class="block"><span class="text-sm font-medium">Email</span><input name="username" type="email" required autocomplete="username" class="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5 bg-white"></label>
          <label class="block"><span class="text-sm font-medium">Password</span><input name="password" type="password" required autocomplete="current-password" class="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5 bg-white"></label>
          <div class="grid grid-cols-2 gap-3">
            <label><span class="text-sm font-medium">Clean after</span><span class="block text-xs text-slate-500 mt-1 leading-relaxed">If a box has not cycled by then, Sentry asks it to start a cleaning cycle.</span><div class="relative mt-2"><input name="cleanAfterHours" type="number" min="1" max="48" value="6" class="w-full rounded-xl border border-slate-300 px-3 py-2.5 pr-12"><span class="absolute right-3 top-2.5 text-slate-400">hrs</span></div></label>
            <label><span class="text-sm font-medium">Alert after</span><span class="block text-xs text-slate-500 mt-1 leading-relaxed">If it is still overdue at this threshold, the dashboard flags it and the Snitch does not receive a check-in.</span><div class="relative mt-2"><input name="alertAfterHours" type="number" min="1" max="72" value="8" class="w-full rounded-xl border border-slate-300 px-3 py-2.5 pr-12"><span class="absolute right-3 top-2.5 text-slate-400">hrs</span></div></label>
          </div>
          <label class="block"><span class="text-sm font-medium">Dead Man's Snitch URL <span class="font-normal text-slate-400">(optional)</span></span><span class="block text-xs text-slate-500 mt-1 leading-relaxed">Dead Man's Snitch adds a backup layer. If you arrange recurring checks with an external scheduler, set its expected check-in schedule to match. The Sentry pings it only after a successful check when each robot is still within the alert threshold. If Sentry stops running—or it runs but a robot stays overdue—the Snitch will alert you.</span><input name="snitchUrl" type="url" placeholder="https://nosnch.in/..." class="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2.5 bg-white"></label>
          <button ${canConnect ? "" : "disabled"} class="w-full rounded-xl bg-[#173a34] text-white font-medium py-3 hover:bg-[#214c44] disabled:opacity-50">${canConnect ? "Connect" : "Read-only access"}</button>
          <p id="form-error" class="text-sm text-rose-700 min-h-5"></p>
        </form>
      </section>
      </div>
    </main>`;
  attachNavigation();
  document.getElementById("connect-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.currentTarget.querySelector("button");
    const error = document.getElementById("form-error");
    const form = new FormData(event.currentTarget);
    button.disabled = true;
    button.textContent = "Connecting…";
    error.textContent = "";
    try {
      const connection = await api.connect({
        username: form.get("username"),
        password: form.get("password"),
        cleanAfterHours: Number(form.get("cleanAfterHours")),
        alertAfterHours: Number(form.get("alertAfterHours")),
        snitchUrl: form.get("snitchUrl") || "",
        timeZone: localTimeZone,
      });
      if (!connection.connected) throw new Error(connection.error || "Unable to connect");
      await api.sync_boxes({});
      currentView = "dashboard";
      await runCheck();
    } catch (err) {
      error.textContent = err.message || "Unable to connect";
      button.disabled = false;
      button.textContent = "Connect";
    }
  });
}

function listRobotNames(robots) {
  const names = [...new Set(robots
    .map((robot) => robot.apiName || robot.name || robot.serial)
    .filter(Boolean)
    .map(String))];
  if (names.length === 0) return "your boxes";
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

function formatHours(hours) {
  return `${Math.round(Number(hours) * 10) / 10} hours`;
}

function shouldShowCoffee(totalCyclesRequested) {
  return Number(totalCyclesRequested) >= 2;
}

function storedFailureKind(status) {
  if (status.lastFailureKind) return status.lastFailureKind;
  const error = String(status.lastError || "");
  if (/(NotAuthorizedException|authentication|identity token|password|refresh token)/i.test(error)) {
    return "credentials_rejected";
  }
  if (/(Whisker API|API unavailable|fetch failed|network|timed? out|ECONN|ENOTFOUND)/i.test(error)) {
    return "api_unavailable";
  }
  return null;
}

function systemMessageFor(status, now = Date.now()) {
  if (!status.configured) {
    return {
      headline: "Litter Sentry reporting for duty.",
      explanation: "Connect your Whisker account to begin patrol.",
    };
  }

  const failureKind = storedFailureKind(status);
  if (failureKind === "credentials_rejected") {
    return {
      headline: "Sentry needs new orders.",
      explanation: "Reconnect your Whisker account to resume monitoring.",
    };
  }

  const scheduledRun = status.lastScheduledRun;
  const interval = Number(status.scheduledCheckIntervalMs) || 60 * 60 * 1000;
  const scheduledRunAt = scheduledRun ? Date.parse(scheduledRun) : NaN;
  if (Number.isFinite(scheduledRunAt) && now - scheduledRunAt > interval * 2) {
    return {
      headline: "Sentry missed its rounds.",
      explanation: `Last scheduled check ran ${new Date(scheduledRunAt).toLocaleString()}.`,
    };
  }

  if (failureKind === "api_unavailable") {
    return {
      headline: "Communications are down.",
      explanation: "Whisker could not be reached. Sentry will try again automatically.",
    };
  }

  const robots = status.robots || [];
  const offline = robots.filter((robot) => robot.online === false);
  if (offline.length) {
    return {
      headline: "A sentry has gone dark.",
      explanation: `Offline robot${offline.length === 1 ? "" : "s"}: ${listRobotNames(offline)}.`,
    };
  }

  const alertAfterHours = Number(status.alertAfterHours);
  const attentionNeeded = robots.filter((robot) =>
    robot.cycleError
    || robot.hoursSinceLastClean == null
    || Number(robot.hoursSinceLastClean) > alertAfterHours,
  );
  if (attentionNeeded.length) {
    const details = attentionNeeded.map((robot) => {
      const name = listRobotNames([robot]);
      if (robot.cycleError) return `${name}: cleaning-cycle request failed (${robot.cycleError}).`;
      if (robot.hoursSinceLastClean == null) return `${name}: no completed cleaning cycle is recorded.`;
      return `${name}: exceeded the ${alertAfterHours}-hour alert threshold (${formatHours(robot.hoursSinceLastClean)} since the last completed cycle).`;
    }).join(" ");
    return {
      headline: "Code brown: attention required.",
      explanation: details,
    };
  }

  const cleanAfterHours = Number(status.cleanAfterHours);
  const warnings = robots.filter((robot) =>
    Number(robot.hoursSinceLastClean) > cleanAfterHours
    && Number(robot.hoursSinceLastClean) <= alertAfterHours,
  );
  if (warnings.length) {
    return {
      headline: "Not all quiet on the litter front.",
      explanation: `Overdue for cleaning but still within the alert threshold: ${listRobotNames(warnings)}.`,
    };
  }

  const dispatched = robots.filter((robot) => robot.cycleRequested);
  if (dispatched.length) {
    return {
      headline: "Cycle dispatched. Crisis averted.",
      explanation: `The Whisker API accepted a cleaning-cycle request for ${listRobotNames(dispatched)}.`,
    };
  }

  return {
    headline: "All’s clean on the litter front.",
    explanation: "Every box has cycled within its configured threshold.",
  };
}

function dashboard(status) {
  const systemMessage = systemMessageFor(status);
  if (!status.configured) {
    root.innerHTML = `
      <main class="min-h-screen bg-[#f3f5f1] text-slate-900 p-5 sm:p-8">
        <div class="max-w-5xl mx-auto">${navigation("dashboard")}
          <section class="max-w-xl mx-auto mt-12 rounded-3xl bg-white border border-slate-200 shadow-sm p-8 text-center">
            <p class="text-xs uppercase tracking-[0.2em] text-emerald-700">Dashboard</p>
            <h1 class="text-3xl font-semibold tracking-tight mt-2">${esc(systemMessage.headline)}</h1>
            <p class="text-slate-500 mt-3 leading-relaxed">${esc(systemMessage.explanation)}</p>
            <button id="configure-settings" class="mt-6 rounded-xl bg-[#173a34] text-white font-medium px-5 py-3 hover:bg-[#214c44]">Open Settings</button>
          </section>
        </div>
      </main>`;
    attachNavigation();
    document.getElementById("configure-settings").addEventListener("click", () => {
      currentView = "settings";
      render();
    });
    return;
  }
  const canRun = window.charming.viewer.can("run_check");
  const cycleCount = Number(status.totalCyclesRequested || 0);
  const cycleWord = cycleCount === 1 ? "cycle" : "cycles";
  const robotList = status.robots || [];
  const robotNames = [...new Set(robotList
    .map((robot) => robot.apiName || robot.name || robot.serial)
    .filter(Boolean))];
  const namedRobots = robotNames.length === 0
    ? "your boxes"
    : robotNames.length === 1
      ? robotNames[0]
      : `${robotNames.slice(0, -1).join(", ")} and ${robotNames.at(-1)}`;
  const requestSummary = cycleCount > 0
    ? `Litter Sentry has requested ${cycleCount} cleaning ${cycleWord} for you.`
    : `We haven't had to request a cycle for ${esc(namedRobots)} yet.`;
  const lastRequest = status.lastCycleRequestedAt
    ? `Last request accepted by the Whisker API: ${esc(new Date(status.lastCycleRequestedAt).toLocaleString())}`
    : "Sentry will count a request once the Whisker API accepts it.";
  const coffeeBlock = shouldShowCoffee(cycleCount) ? `
        <section class="rounded-2xl bg-[#5F7FFF] text-white p-6 mb-6 shadow-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-5">
          <div>
            <p class="text-xs uppercase tracking-[0.16em] text-blue-100">Keep the boxes covered</p>
            <h2 class="text-2xl font-semibold mt-1">Did Sentry save you from disaster?</h2>
            <p class="text-blue-50 mt-2">That seems worth buying me a coffee.</p>
          </div>
          <a href="https://buymeacoffee.com/inevitable.alan" target="_blank" rel="noopener noreferrer" class="shrink-0 rounded-xl bg-white text-[#4059b6] font-semibold px-6 py-3 text-center hover:bg-blue-50">☕ Buy me a coffee</a>
        </section>` : "";
  const sourceDiagnostics = (status.sourceDiagnostics || []).filter((diagnostic) => diagnostic.status === "error");
  const diagnostics = sourceDiagnostics.length ? `
    <details class="rounded-2xl bg-amber-50 border border-amber-200 px-5 py-4 mb-6 text-amber-950">
      <summary class="cursor-pointer font-semibold">Data-source diagnostics</summary>
      <p class="text-sm mt-2">The boxes shown above loaded correctly. The unavailable source is listed below.</p>
      <ul class="mt-3 space-y-2 text-sm">${sourceDiagnostics.map((diagnostic) => `<li><strong>${esc(diagnostic.source)} API:</strong> ${esc(diagnostic.error)}</li>`).join("")}</ul>
    </details>` : "";
  const robots = robotList.map((robot) => robotCard(robot, status.alertAfterHours)).join("");
  root.innerHTML = `
    <main class="min-h-screen bg-[#f3f5f1] text-slate-900 p-5 sm:p-8 pb-24">
      <div class="max-w-5xl mx-auto">${navigation("dashboard")}
        <header class="flex flex-col lg:flex-row lg:items-center justify-between gap-8 mb-10">
          <div class="flex flex-col sm:flex-row sm:items-center gap-5 sm:gap-8">
            <img src="${logoUrl}" alt="Litter Sentry logo" class="h-44 w-44 shrink-0 object-contain">
            <div>
            <h1 class="text-3xl sm:text-4xl font-semibold tracking-tight">${esc(systemMessage.headline)}</h1>
            <p class="text-slate-500 mt-2">${esc(systemMessage.explanation)}</p>
            <p class="text-sm text-slate-400 mt-1">${status.lastRun ? `Last checked ${esc(new Date(status.lastRun).toLocaleString())}` : "No check has run yet"}</p>
            <p class="text-sm text-slate-400 mt-1">Connected as ${esc(status.account)}</p>
            </div>
          </div>
          <div class="flex flex-wrap gap-3">
            <button id="run" ${canRun ? "" : "disabled"} class="rounded-xl bg-[#173a34] text-white font-medium px-5 py-3 hover:bg-[#214c44] disabled:opacity-50">${canRun ? "Run check now" : "Read-only access"}</button>
          </div>
        </header>
        ${status.lastError ? `<div class="rounded-xl bg-rose-50 border border-rose-200 text-rose-800 px-4 py-3 mb-5">${esc(status.lastError)}</div>` : ""}
        ${diagnostics}
        <section class="rounded-2xl bg-[#173a34] text-white p-5 mb-6 shadow-sm">
          <p class="text-xs uppercase tracking-[0.16em] text-emerald-100">Cycle requests</p>
          <p class="text-xl font-semibold mt-1">${requestSummary}</p>
          <p class="text-sm text-emerald-100 mt-2">${lastRequest}</p>
        </section>
        ${coffeeBlock}
        <section class="grid sm:grid-cols-3 gap-3 mb-6">
          <div class="rounded-2xl bg-white border border-slate-200 p-4"><p class="text-xs uppercase tracking-wider text-slate-400">Clean threshold</p><p class="text-2xl font-semibold mt-1">${esc(status.cleanAfterHours)}h</p></div>
          <div class="rounded-2xl bg-white border border-slate-200 p-4"><p class="text-xs uppercase tracking-wider text-slate-400">Alert threshold</p><p class="text-2xl font-semibold mt-1">${esc(status.alertAfterHours)}h</p></div>
          <div class="rounded-2xl bg-white border border-slate-200 p-4"><p class="text-xs uppercase tracking-wider text-slate-400">Dead Man's Snitch</p><p class="text-lg font-semibold mt-2">${status.snitchConfigured ? "Configured" : "Not configured"}</p></div>
        </section>
        <section class="grid xl:grid-cols-2 gap-5">${robots || '<div class="rounded-2xl bg-white border border-slate-200 p-8 text-center text-slate-500">Run the first check to load your robots.</div>'}</section>
      </div>
    </main>`;
  attachNavigation();
  if (canRun) document.getElementById("run").addEventListener("click", runCheck);
}

async function saveSettings(event) {
  event.preventDefault();
  const button = event.currentTarget.querySelector("button");
  const error = document.getElementById("settings-error");
  const form = new FormData(event.currentTarget);
  const snitchUrl = String(form.get("snitchUrl") || "").trim();
  const settings = {
    cleanAfterHours: Number(form.get("cleanAfterHours")),
    alertAfterHours: Number(form.get("alertAfterHours")),
    snitchUrl,
    timeZone: String(form.get("timeZone") || localTimeZone).trim(),
  };
  button.disabled = true;
  button.textContent = "Saving…";
  error.textContent = "";
  try {
    await api.configure(settings);
    await render();
  } catch (err) {
    error.textContent = err.message || "Unable to save settings";
    button.disabled = false;
    button.textContent = "Save settings";
  }
}

async function runCheck() {
  const button = document.getElementById("run");
  if (button) {
    button.disabled = true;
    button.textContent = "Checking…";
  }
  try {
    await api.run_check({ timeZone: activeTimeZone });
  } catch (_) {
    // The stored status contains the durable error shown after refresh.
  }
  await render();
}

async function syncBoxes() {
  const button = document.getElementById("sync-boxes");
  const error = document.getElementById("sync-error");
  button.disabled = true;
  button.textContent = "Syncing…";
  error.textContent = "";
  try {
    await api.sync_boxes({});
    await render();
  } catch (err) {
    error.textContent = err.message || "Unable to sync active boxes";
    button.disabled = false;
    button.textContent = "Sync active boxes";
  }
}

async function disconnect() {
  if (!window.confirm("Disconnect this Whisker account? This removes its saved credentials and check history from Litter Sentry.")) return;
  const button = document.getElementById("disconnect");
  button.disabled = true;
  button.textContent = "Disconnecting…";
  try {
    await api.disconnect({});
    currentView = "settings";
    await render();
  } catch (err) {
    button.disabled = false;
    button.textContent = "Disconnect account";
    window.alert(err.message || "Unable to disconnect the account");
  }
}

async function render() {
  try {
    const status = await api.status();
    activeTimeZone = status.timeZone || localTimeZone;
    if (currentView === "settings") settingsView(status);
    else dashboard(status);
  } catch (err) {
    root.innerHTML = `<main class="min-h-screen bg-[#f3f5f1] grid place-items-center p-6"><div class="max-w-md rounded-2xl bg-white border border-rose-200 p-6"><h1 class="text-xl font-semibold">Sentry couldn't load</h1><p class="text-slate-500 mt-2">${esc(err.message || err)}</p></div></main>`;
  }
}

window.charming.onStateChange?.(() => {
  if (currentView === "dashboard") render();
});

render();
