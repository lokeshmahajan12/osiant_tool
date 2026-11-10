import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import type { InputType } from "../types";
import { api } from "../lib/api";
import { useToast } from "../context/ToastContext";
import { ConsentNotice } from "../components/ConsentNotice";
import { Button, Card, Spinner, Tabs } from "../components/ui";

const INPUT_TYPES: InputType[] = ["EMAIL", "PHONE", "USERNAME", "DOMAIN", "IP"];
const EXAMPLES: Record<InputType, string> = {
  EMAIL: "analyst@example.com",
  PHONE: "+14155552671",
  USERNAME: "alice_analyst",
  DOMAIN: "example.com",
  IP: "8.8.8.8",
};
const PLACEHOLDERS: Record<InputType, string> = {
  EMAIL: "you@example.com",
  PHONE: "+1 555 010 1234",
  USERNAME: "username",
  DOMAIN: "example.com",
  IP: "203.0.113.1",
};

export function Investigate() {
  const navigate = useNavigate();
  const { push } = useToast();
  const [type, setType] = useState<InputType>("EMAIL");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!value.trim()) return;
    setBusy(true);
    setError("");
    try {
      const { id } = await api.createInvestigation(type, value.trim());
      push("success", "Investigation started");
      navigate(`/investigation/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start investigation");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="font-mono text-xl font-semibold text-slate-100">Investigate</h1>
        <p className="mt-1 text-sm text-slate-500">
          Run an authorized metadata investigation against public sources. Results are stored for {">"}your retention window.
        </p>
      </div>

      <ConsentNotice />

      <Card title="New investigation">
        <form onSubmit={submit} className="space-y-5">
          <Tabs<InputType>
            tabs={INPUT_TYPES.map((t) => ({ id: t, label: t }))}
            active={type}
            onChange={(t) => {
              setType(t);
              setValue("");
              setError("");
            }}
          />
          <input
            className="input font-mono"
            placeholder={PLACEHOLDERS[type]}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            autoFocus
            required
            maxLength={500}
          />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              className="text-xs text-slate-500 hover:text-accent-soft"
              onClick={() => setValue(EXAMPLES[type])}
            >
              Use example: {EXAMPLES[type]}
            </button>
            <div className="flex items-center gap-3">
              {error && <span className="text-xs text-signal-danger">{error}</span>}
              <Button type="submit" loading={busy} disabled={!value.trim()}>
                {busy ? <Spinner label="Querying providers…" /> : "Start investigation"}
              </Button>
            </div>
          </div>
        </form>
      </Card>

      <Card title="What will be collected">
        <ul className="grid gap-2 text-sm text-slate-400 md:grid-cols-2">
          <li className="flex items-center gap-2"><span className="text-signal">✓</span> Public DNS / RDAP / header metadata</li>
          <li className="flex items-center gap-2"><span className="text-signal">✓</span> Breach exposure status (names & dates)</li>
          <li className="flex items-center gap-2"><span className="text-signal">✓</span> Provider-returned reputation scores</li>
          <li className="flex items-center gap-2"><span className="text-signal">✓</span> Coarse IP/phone metadata</li>
          <li className="flex items-center gap-2"><span className="text-danger">✕</span> Passwords, tokens, private messages</li>
          <li className="flex items-center gap-2"><span className="text-danger">✕</span> Live location or GPS tracking</li>
        </ul>
      </Card>
    </div>
  );
}
