import { useState } from "react";

export function ConsentNotice() {
  const [accepted, setAccepted] = useState(false);
  const [acked, setAcked] = useState(false);

  return (
    <div className="panel border-accent-dim/40 p-5">
      <div className="mb-2 flex items-center gap-2">
        <span className="badge bg-accent/15 text-accent-soft">Authorization required</span>
        <span className="badge bg-slate-500/15 text-slate-400">Public data only</span>
      </div>
      <p className="text-sm leading-relaxed text-slate-300">
        Use this application only for <strong className="text-accent-soft">systems, accounts, domains, and data that
        you own or are explicitly authorized to investigate</strong>. SENTINEL collects only publicly available
        metadata returned by legitimate APIs — never passwords, private messages, or live locations. Unauthorized use
        may violate law or policy and is the responsibility of the investigator.
      </p>
      <label className="mt-4 flex cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          checked={accepted}
          onChange={(e) => setAccepted(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-ink-600 bg-ink-800 accent-cyan-400"
        />
        <span className="text-sm text-slate-300">
          I confirm I am authorized to run this investigation and understand the platform's privacy boundary.
        </span>
      </label>
      <button
        type="button"
        disabled={!accepted || acked}
        onClick={() => setAcked(true)}
        className="btn-ghost mt-4 w-full text-xs disabled:opacity-40"
      >
        {acked ? "Acknowledged ✓" : "Acknowledge consent"}
      </button>
    </div>
  );
}
