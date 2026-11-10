import type { PresenceStage, SharingStatus } from "../types";

interface LiveStatusBadgeProps {
  sharing: SharingStatus;
  compact?: boolean;
}

export function LiveStatusBadge({ sharing, compact }: LiveStatusBadgeProps) {
  if (sharing === "LIVE") {
    return (
      <span
        className={`badge ${compact ? "" : "px-2.5 py-1 text-xs"} animate-pulseSoft bg-signal/15 text-signal`}
        title="Location sharing active"
      >
        <span className="h-2 w-2 rounded-full bg-signal" />
        {compact ? "LIVE" : "LIVE — Location sharing active"}
      </span>
    );
  }
  if (sharing === "STALE") {
    return (
      <span
        className={`badge ${compact ? "" : "px-2.5 py-1 text-xs"} animate-pulseSoft bg-signal-warn/15 text-signal-warn`}
        title="No GPS fix received recently — session is stale"
      >
        <span className="h-2 w-2 rounded-full bg-signal-warn" />
        {compact ? "STALE" : "STALE — no fix received recently"}
      </span>
    );
  }
  return (
    <span className={`badge ${compact ? "" : "px-2.5 py-1 text-xs"} bg-slate-500/15 text-slate-400`} title="Location sharing stopped">
      <span className="h-2 w-2 rounded-full bg-slate-500" />
      {compact ? "OFF" : "OFF — Location sharing stopped"}
    </span>
  );
}

export function PresenceBadge({ stage }: { stage: PresenceStage }) {
  if (stage === "LIVE") {
    return (
      <span className="badge bg-signal/15 text-signal">
        <span className="h-1.5 w-1.5 rounded-full bg-signal" />
        LIVE
      </span>
    );
  }
  if (stage === "STALE") {
    return (
      <span className="badge bg-signal-warn/15 text-signal-warn">
        <span className="h-1.5 w-1.5 rounded-full bg-signal-warn" />
        STALE
      </span>
    );
  }
  return (
    <span className="badge bg-signal-danger/15 text-signal-danger">
      <span className="h-1.5 w-1.5 rounded-full bg-signal-danger" />
      OFFLINE
    </span>
  );
}

export function OnlineBadge({ online }: { online: boolean }) {
  return online ? (
    <span className="badge bg-signal/15 text-signal">
      <span className="h-1.5 w-1.5 rounded-full bg-signal" />
      Online
    </span>
  ) : (
    <span className="badge bg-signal-danger/15 text-signal-danger">
      <span className="h-1.5 w-1.5 rounded-full bg-signal-danger" />
      Device Offline
    </span>
  );
}
