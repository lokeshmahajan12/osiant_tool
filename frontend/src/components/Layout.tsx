import { NavLink, Navigate, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { Logo } from "./Logo";
import type { Role } from "../types";

interface NavItem {
  to: string;
  label: string;
  icon: string;
  roles: Role[];
}

const NAV: NavItem[] = [
  { to: "/dashboard", label: "Dashboard", icon: "◫", roles: ["ADMIN", "ANALYST", "INVESTIGATOR", "USER"] },
  { to: "/investigate", label: "Investigate", icon: "◎", roles: ["ADMIN", "ANALYST", "INVESTIGATOR"] },
  { to: "/history", label: "History", icon: "▤", roles: ["ADMIN", "ANALYST", "INVESTIGATOR"] },
  { to: "/live-location", label: "Live Location", icon: "✥", roles: ["ADMIN", "ANALYST", "INVESTIGATOR"] },
  { to: "/devices", label: "Devices", icon: "◈", roles: ["ADMIN", "ANALYST", "INVESTIGATOR"] },
  { to: "/admin/users", label: "Users", icon: "◉", roles: ["ADMIN"] },
  { to: "/live-map", label: "Live Map", icon: "⌖", roles: ["ADMIN"] },
  { to: "/camera-sessions", label: "Cameras", icon: "◔", roles: ["ADMIN"] },
  { to: "/providers", label: "Providers", icon: "⬢", roles: ["ADMIN", "INVESTIGATOR"] },
  { to: "/permission-center", label: "Permissions", icon: "⚛", roles: ["USER"] },
  { to: "/camera", label: "Camera", icon: "◉", roles: ["USER"] },
  { to: "/settings", label: "Settings", icon: "⚙", roles: ["ADMIN", "ANALYST", "INVESTIGATOR", "USER"] },
  { to: "/audit-log", label: "Audit Log", icon: "☰", roles: ["ADMIN"] },
  { to: "/privacy", label: "Privacy", icon: "✕", roles: ["ADMIN", "ANALYST", "INVESTIGATOR", "USER"] },
];

export function Layout() {
  const { user, loading, logout } = useAuth();
  const navigate = useNavigate();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="font-mono text-sm text-slate-500">establishing secure session…</div>
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;

  const items = NAV.filter((item) => item.roles.includes(user.role));

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  return (
    <div className="min-h-screen bg-ink-950">
      <aside className="no-print fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-ink-700 bg-ink-900/90 backdrop-blur md:flex">
        <div className="border-b border-ink-700 px-5 py-5">
          <Logo />
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4 scroll-thin">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition ${
                  isActive ? "bg-ink-800 text-accent-soft" : "text-slate-400 hover:bg-ink-850 hover:text-slate-200"
                }`
              }
            >
              <span className="w-4 text-center text-accent-dim">{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-ink-700 p-4">
          <div className="mb-3 truncate text-xs text-slate-500">
            {user.name} <span className="text-accent-dim">· {user.role.toLowerCase()}</span>
          </div>
          <button onClick={handleLogout} className="btn-ghost w-full text-xs">
            Sign out
          </button>
        </div>
      </aside>

      <div className="md:pl-60">
        <header className="no-print sticky top-0 z-20 flex items-center justify-between border-b border-ink-700 bg-ink-950/90 px-4 py-3 backdrop-blur md:hidden">
          <Logo size={26} />
          <button onClick={handleLogout} className="btn-ghost text-xs">
            Sign out
          </button>
        </header>
        <nav className="no-print sticky top-[61px] z-20 flex gap-1 overflow-x-auto border-b border-ink-700 bg-ink-950/90 px-3 py-2 backdrop-blur scroll-thin md:hidden">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs font-medium ${
                  isActive ? "bg-ink-800 text-accent-soft" : "text-slate-400"
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <main className="mx-auto max-w-7xl px-4 py-6 md:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}