// Keep updates user-controlled so a new worker never interrupts an open session.
export async function observeAppStatus({ serviceWorker, events, isOnline, onOffline, onUpdateReady }) {
  let registration = null;
  let controller = serviceWorker?.controller ?? null;
  const refreshConnection = () => onOffline(isOnline() === false);
  const online = () => {
    refreshConnection();
    // Reconnection is a useful time to check for a release missed while offline.
    if (registration) Promise.resolve().then(() => registration.update()).catch(() => {});
  };
  const controllerChanged = () => {
    const next = serviceWorker.controller;
    if (controller && next && next !== controller) onUpdateReady();
    controller = next;
  };
  events.addEventListener("offline", refreshConnection);
  events.addEventListener("online", online);
  serviceWorker?.addEventListener("controllerchange", controllerChanged);
  refreshConnection();
  if (serviceWorker) {
    registration = await serviceWorker.register("/service-worker.js", { scope: "/", updateViaCache: "none" });
  }
  return registration;
}
