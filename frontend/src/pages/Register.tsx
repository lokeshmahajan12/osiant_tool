import { useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { Logo } from "../components/Logo";
import { Button } from "../components/ui";

interface RegisterForm {
  name: string;
  username: string;
  email: string;
  mobile: string;
  country: string;
  state: string;
  city: string;
  password: string;
  confirmPassword: string;
}

const EMPTY: RegisterForm = {
  name: "",
  username: "",
  email: "",
  mobile: "",
  country: "",
  state: "",
  city: "",
  password: "",
  confirmPassword: "",
};

function validate(f: RegisterForm): string | null {
  if (f.name.trim().length < 2) return "Please enter your full name.";
  if (f.username && !/^[a-z0-9._-]{3,32}$/i.test(f.username.trim())) return "Username must be 3-32 characters (letters, numbers, dot, dash, underscore).";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) return "Please enter a valid email address.";
  if (f.mobile && !/^[+]?[\d\s()-]{7,20}$/.test(f.mobile.trim())) return "Please enter a valid mobile number (e.g. +919876543210).";
  if (f.password.length < 8) return "Password must be at least 8 characters.";
  if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(f.password)) return "Password must contain a lowercase letter, an uppercase letter and a number.";
  if (f.password !== f.confirmPassword) return "Passwords do not match.";
  return null;
}

export function Register() {
  const { register, user } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState<RegisterForm>(EMPTY);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/dashboard" replace />;

  const set = (key: keyof RegisterForm) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    const problem = validate(form);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    try {
      await register({
        name: form.name.trim(),
        username: form.username.trim() || undefined,
        email: form.email.trim(),
        mobile: form.mobile.trim() || undefined,
        password: form.password,
        confirmPassword: form.confirmPassword,
        country: form.country.trim() || undefined,
        state: form.state.trim() || undefined,
        city: form.city.trim() || undefined,
      });
      navigate("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-ink-950 px-4 py-8">
      <div className="w-full max-w-md">
        <div className="mb-6 flex justify-center"><Logo size={44} /></div>
        <form onSubmit={submit} className="panel space-y-4 p-7">
          <div>
            <h1 className="font-mono text-lg font-semibold text-slate-100">Create account</h1>
            <p className="mt-1 text-xs text-slate-500">
              Register an end-user portal account for consent-based monitoring.
            </p>
          </div>

          <div className="space-y-3">
            <input className="input" type="text" autoComplete="name" placeholder="Full name" value={form.name} onChange={set("name")} required />
            <div className="grid grid-cols-2 gap-3">
              <input className="input" type="text" autoComplete="username" placeholder="Username (optional)" value={form.username} onChange={set("username")} />
              <input className="input" type="tel" autoComplete="tel" placeholder="Mobile (optional)" value={form.mobile} onChange={set("mobile")} />
            </div>
            <input className="input" type="email" autoComplete="email" placeholder="Email address" value={form.email} onChange={set("email")} required />
            <div className="grid grid-cols-3 gap-3">
              <input className="input" type="text" autoComplete="country-name" placeholder="Country" value={form.country} onChange={set("country")} />
              <input className="input" type="text" placeholder="State" value={form.state} onChange={set("state")} />
              <input className="input" type="text" placeholder="City" value={form.city} onChange={set("city")} />
            </div>
            <input className="input" type="password" autoComplete="new-password" placeholder="Password (min 8: upper, lower, number)" value={form.password} onChange={set("password")} required />
            <input className="input" type="password" autoComplete="new-password" placeholder="Confirm password" value={form.confirmPassword} onChange={set("confirmPassword")} required />
          </div>

          {error && <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div>}

          <Button type="submit" className="w-full" loading={busy}>
            {busy ? "Creating account…" : "Create account"}
          </Button>

          <p className="text-center text-xs text-slate-500">
            Already have an account?{" "}
            <Link to="/login" className="text-accent-soft hover:text-accent">Sign in</Link>
          </p>
          <p className="text-center text-[10px] leading-relaxed text-slate-600">
            By registering you agree to the platform's privacy policy. Location data is only collected after you
            explicitly grant permission.
          </p>
        </form>
      </div>
    </div>
  );
}