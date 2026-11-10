import { Link } from "react-router-dom";

export function ConsentBanner({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="rounded-xl border border-accent-dim/40 bg-accent/10 p-4 text-sm text-slate-200">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <p className="font-semibold text-accent-soft">Consent & privacy setup required</p>
          <p className="text-xs text-slate-400">
            Review what data SENTINEL collects and explicitly grant (or deny) access to your location, camera,
            microphone and notifications. No sensitive data is shared without your permission.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Link to="/permission-center" className="btn-primary text-xs">
            Review permissions
          </Link>
          <button onClick={onDismiss} className="btn-ghost text-xs">
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}