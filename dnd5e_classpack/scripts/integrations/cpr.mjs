import { TimedDialogManager } from "../api/timed-dialogs.mjs";
import { log } from "../api/utils.mjs";

let manager;

export function isCPRIntegrationEnabled() {
  return !!game.modules?.get("chris-premades")?.active && !!game.modules?.get("cat")?.active;
}

/** All module scripts load before ready; CAT emits catReady after its async startup. */
export function registerCPRIntegration(api) {
  let classpackReady = false, catReady = false;
  const register = () => {
    if (manager || !classpackReady || !catReady || !isCPRIntegrationEnabled()) return;
    manager = new TimedDialogManager(api);
    api.cpr = manager.publicAPI;
    Hooks.on("userConnected", (user, connected) => manager.userConnected(user, connected));
  };
  Hooks.once("dnd5eClasspackReady", () => { classpackReady = true; register(); });
  Hooks.once("catReady", () => { catReady = true; register(); });
}

// Normal functions preserve socketlib's authenticated this.socketdata.userId.
// The transport is registered with ClassPack's existing socket operations;
// inactive optional integrations reject it without creating windows or state.
export const cprSocketFunctions = Object.fromEntries(["open", "update", "close", "respond"].map(operation => [
  `cprTimed${operation[0].toUpperCase()}${operation.slice(1)}`,
  function (payload) {
    try { return manager?.[operation](payload, this.socketdata?.userId) ?? false; }
    catch (error) { log("warn", `Timed dialog ${operation} rejected:`, error); return false; }
  }
]));
