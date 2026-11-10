import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, downloadBlob } from "../lib/api";
import type { DirectoryUser, Role } from "../types";
import { Button, EmptyState, Spinner, formatDate, timeAgo } from "../components/ui";
import { useToast } from "../context/ToastContext";

type SortKey = "createdAt" | "lastLoginAt" | "name" | "email" | "role";

const PAGE_SIZE = 20;

function exportCsv(items: DirectoryUser[]) {
  const header = [
    "name",
    "email",
    "username",
    "mobile",
    "role",
    "status",
    "online",
    "locationSharing",
    "locationPermission",
    "cameraPermission",
    "microphonePermission",
    "notificationPermission",
    "lastSeen",
    "lastLocationUpdate",
    "deviceCount",
    "activeSessions",
    "monitoringStatus",
  ];
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows = items.map((u) => [
    u.name,
    u.email,
    u.username,
    u.mobile,
    u.role,
    u.isActive ? "active" : "inactive",
    u.online ? "online" : "offline",
    u.locationSharing ? "yes" : "no",
    u.locationPermission,
    u.cameraPermission,
    u.microphonePermission,
    u.notificationPermission,
    u.lastSeen,
    u.lastLocationUpdate,
    u.deviceCount,
    u.activeSessions,
    u.monitoringStatus,
  ]);
  downloadBlob(`sentinel-users-${new Date().toISOString().slice(0, 10)}.csv`, [header.join(","), ...rows.map((r) => r.map(esc).join(","))].join("\n"), "text/csv");
}

const ROLE_BADGE: Record<Role, string> = {
  ADMIN: "bg-accent/15 text-accent-soft",
  INVESTIGATOR: "bg-signal-warn/15 text-signal-warn",
  ANALYST: "bg-signal/15 text-signal",
  USER: "bg-slate-500/15 text-slate-300",
};

export function AdminUsers() {
  const { push: toast } = useToast();
  const [items, setItems] = useState<DirectoryUser[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [role, setRole] = useState("ALL");
  const [status, setStatus] = useState("ALL");
  const [online, setOnline] = useState("ALL");
  const [sort, setSort] = useState<SortKey>("createdAt");
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.listDirectory({
        search: debouncedSearch || undefined,
        role: role === "ALL" ? undefined : role,
        status: status === "ALL" ? undefined : status,
        online: online === "ALL" ? undefined : online,
        sort,
        order,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      });
      setItems(res.items);
      setTotal(res.total);
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Failed to load users");
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, role, status, online, sort, order, page, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleSort = (key: SortKey) => {
    if (sort === key) {
      setOrder((o) => (o === "asc" ? "desc" : "asc"));
    } else {
      setSort(key);
      setOrder("desc");
    }
    setPage(0);
  };

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-mono text-xl font-semibold text-slate-100">Users directory</h1>
          <p className="mt-1 text-sm text-slate-500">{total} registered accounts</p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" className="text-xs" onClick={() => exportCsv(items)} disabled={items.length === 0}>
            Export CSV
          </Button>
          <Link to="/live-map" className="btn-primary text-xs">
            Live map
          </Link>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <input
          className="input"
          type="search"
          placeholder="Search name, email, username, mobile…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(0);
          }}
        />
        <select className="input" value={role} onChange={(e) => { setRole(e.target.value); setPage(0); }}>
          <option value="ALL">All roles</option>
          <option value="USER">USER</option>
          <option value="ANALYST">ANALYST</option>
          <option value="INVESTIGATOR">INVESTIGATOR</option>
          <option value="ADMIN">ADMIN</option>
        </select>
        <select className="input" value={status} onChange={(e) => { setStatus(e.target.value); setPage(0); }}>
          <option value="ALL">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
        <select className="input" value={online} onChange={(e) => { setOnline(e.target.value); setPage(0); }}>
          <option value="ALL">Any online state</option>
          <option value="true">Online</option>
          <option value="false">Offline</option>
        </select>
      </div>

      <div className="panel overflow-hidden">
        <div className="overflow-x-auto scroll-thin">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-ink-700 text-[11px] uppercase tracking-wider text-slate-500">
                <th className="cursor-pointer px-4 py-3 hover:text-slate-300" onClick={() => toggleSort("name")}>
                  Name {sort === "name" ? (order === "asc" ? "▲" : "▼") : ""}
                </th>
                <th className="hidden px-4 py-3 lg:table-cell">Contact</th>
                <th className="cursor-pointer px-4 py-3 hover:text-slate-300" onClick={() => toggleSort("role")}>
                  Role {sort === "role" ? (order === "asc" ? "▲" : "▼") : ""}
                </th>
                <th className="px-4 py-3">State</th>
                <th className="px-4 py-3">Permissions</th>
                <th className="hidden cursor-pointer px-4 py-3 md:table-cell hover:text-slate-300" onClick={() => toggleSort("lastLoginAt")}>
                  Last seen {sort === "lastLoginAt" ? (order === "asc" ? "▲" : "▼") : ""}
                </th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-800">
              {items.map((u) => (
                <tr key={u.id} className="hover:bg-ink-850/50">
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-200">{u.name}</div>
                    <div className="text-[11px] text-slate-500">{u.email}</div>
                  </td>
                  <td className="hidden px-4 py-3 lg:table-cell">
                    <div className="text-xs text-slate-300">{u.username ?? "—"}</div>
                    <div className="text-[11px] text-slate-500">{u.mobile ?? "no mobile"}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`badge ${ROLE_BADGE[u.role] ?? "bg-slate-500/15 text-slate-300"}`}>{u.role}</span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className={`h-2 w-2 rounded-full ${u.isActive ? "bg-signal" : "bg-signal-danger"}`} />
                      <span className={`text-xs ${u.online ? "text-signal" : "text-slate-500"}`}>
                        {u.isActive ? (u.online ? "Active · online" : "Active · offline") : "Disabled"}
                      </span>
                    </div>
                    {u.locationSharing && <div className="mt-1 badge bg-accent/15 text-accent-soft">● sharing</div>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      <span className={`badge ${u.locationPermission === "GRANTED" ? "bg-signal/15 text-signal" : u.locationPermission === "DENIED" || u.locationPermission === "REVOKED" ? "bg-signal-danger/15 text-signal-danger" : "bg-slate-500/15 text-slate-400"}`}>
                        L:{u.locationPermission}
                      </span>
                      <span className={`badge ${u.cameraPermission === "GRANTED" ? "bg-signal/15 text-signal" : "bg-slate-500/15 text-slate-400"}`}>
                        C:{u.cameraPermission}
                      </span>
                    </div>
                  </td>
                  <td className="hidden px-4 py-3 md:table-cell">
                    <div className="text-xs text-slate-400">{u.lastSeen ? timeAgo(u.lastSeen) : "never"}</div>
                    <div className="text-[10px] text-slate-600">{u.lastSeen ? formatDate(u.lastSeen) : "—"}</div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link to={`/admin/users/${u.id}`} className="btn-ghost text-xs">
                      View
                    </Link>
                  </td>
                </tr>
              ))}
              {!loading && items.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-10">
                    <EmptyState title="No users match the current filters" />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {loading && (
          <div className="flex justify-center py-6">
            <Spinner label="Loading users…" />
          </div>
        )}
        <div className="flex items-center justify-between border-t border-ink-700 px-4 py-3 text-xs text-slate-400">
          <span>
            Page {page + 1} of {pages} · {total} users
          </span>
          <div className="flex gap-2">
            <button className="btn-ghost text-xs" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
              ← Prev
            </button>
            <button className="btn-ghost text-xs" disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)}>
              Next →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}