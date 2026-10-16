import { APP_VERSION, isDesktopApp, useUpdateStore } from "../store/updateStore";
import { Modal } from "./Modals";

/** Gold ribbon on the menu screens when a new version is ready to install. */
export function UpdateBanner() {
  const { status, version, openDialog } = useUpdateStore();
  if (status !== "available" && status !== "downloading") return null;
  return (
    <button className="update-banner" onClick={() => openDialog(true)}>
      <span className="update-dot" aria-hidden />
      Version {version} is available. <strong>Update now</strong>
    </button>
  );
}

export function UpdateDialog() {
  const { dialogOpen, status, version, notes, progress, error, install, openDialog } = useUpdateStore();
  if (!dialogOpen) return null;
  const busy = status === "downloading" || status === "ready";
  return (
    <Modal title={`Update to ${version}`} onClose={() => !busy && openDialog(false)}>
      <p className="text-2" style={{ margin: 0 }}>
        You have version {APP_VERSION}. The new version downloads in the background, then the game restarts. Your settings and
        stats are kept.
      </p>
      {notes && (
        <div className="box update-notes">
          <strong>What's new</strong>
          <div>{notes}</div>
        </div>
      )}
      {busy && (
        <div>
          <div className="meter" style={{ height: "0.9rem" }}>
            <div style={{ width: `${Math.round((progress ?? 0.5) * 100)}%`, background: "var(--accent)" }} />
          </div>
          <div className="note">{status === "ready" ? "Installed. Restarting…" : progress === null ? "Downloading…" : `Downloading… ${Math.round(progress * 100)}%`}</div>
        </div>
      )}
      {status === "error" && <div className="note warn-note">Update failed: {error}</div>}
      <div style={{ display: "flex", gap: "0.6rem", justifyContent: "flex-end" }}>
        {!busy && (
          <button className="btn" onClick={() => openDialog(false)}>
            Later
          </button>
        )}
        <button className="btn btn-primary" onClick={install} disabled={busy}>
          {status === "error" ? "Try again" : "Install & restart"}
        </button>
      </div>
    </Modal>
  );
}

/** "About" row in Settings: current version and a manual update check. */
export function AboutSection() {
  const { status, version, check, openDialog } = useUpdateStore();
  const desktop = isDesktopApp();
  const label: Record<string, string> = {
    idle: "",
    checking: "Checking…",
    none: "You have the latest version.",
    available: `Version ${version} is available.`,
    downloading: "Downloading update…",
    ready: "Restarting…",
    error: "Couldn't check for updates. Are you online?",
  };
  return (
    <div className="field">
      <div>
        <div>Version {APP_VERSION}</div>
        <div className="desc">
          {desktop ? label[status] || "The game checks for updates each time it starts." : "Updates install automatically in the desktop app."}
        </div>
      </div>
      {desktop &&
        (status === "available" ? (
          <button className="btn btn-primary btn-sm" onClick={() => openDialog(true)}>
            Update
          </button>
        ) : (
          <button className="btn btn-sm" onClick={() => check(false)} disabled={status === "checking"}>
            Check for updates
          </button>
        ))}
    </div>
  );
}
