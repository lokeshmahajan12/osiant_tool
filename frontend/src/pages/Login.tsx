import { useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { Logo } from "../components/Logo";
import { Button, Spinner } from "../components/ui";

export function Login() {
  const { login, user } = useAuth();
  const navigate = useNavigate();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (user) {
    return <Navigate to="/dashboard" replace />;
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await login(identifier.trim(), password);
      navigate("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-ink-950 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center"><Logo size={44} /></div>
        <form onSubmit={submit} className="panel space-y-4 p-7">
          <div>
            <h1 className="font-mono text-lg font-semibold text-slate-100">Sign in</h1>
            <p className="mt-1 text-xs text-slate-500">Use your email, username or mobile number.</p>
          </div>
          <div className="space-y-3">
            <input
              className="input"
              type="text"
              autoComplete="username"
              placeholder="email@organization.io · username · mobile"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              required
            />
            <input
              className="input"
              type="password"
              autoComplete="current-password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          {error && <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div>}
          <Button type="submit" className="w-full" loading={busy}>
            {busy ? <Spinner /> : "Authenticate"}
          </Button>
          <div className="flex items-center justify-between text-xs">
            <Link to="/register" className="text-accent-soft hover:text-accent">
              Create an account
            </Link>
            <span className="text-slate-600">Authorized personnel only</span>
          </div>
          <p className="text-center text-[10px] leading-relaxed text-slate-600">
            Use only for systems, accounts, domains and data you own or are authorized to investigate.
          </p>
        </form>
      </div>
    </div>
  );
}
