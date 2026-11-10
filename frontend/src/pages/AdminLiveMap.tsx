import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Socket } from "socket.io-client";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { api } from "../lib/api";
import type { LiveMapUser, LocationFix } from "../types";
import { Button, Card, Spinner, timeAgo } from "../components/ui";
import { connectLocationSocket, disconnectLocationSocket } from "../lib/socket";
import { useToast } from "../context/ToastContext";

const DARK_TILE_URL = "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";

function cellKey(lat: number, lng: number, cellSize: number): string {
  return `${Math.round(lat / cellSize)}:${Math.round(lng / cellSize)}`;
}

function cellSizeForZoom(zoom: number): number {
  return 0.35 * (360 / Math.pow(2, zoom));
}

export function AdminLiveMap() {
  const { push: toast } = useToast();
  const [users, setUsers] = useState<LiveMapUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [sharingOnly, setSharingOnly] = useState(false);
  const [onlineOnly, setOnlineOnly] = useState(false);
  const [selected, setSelected] = useState<LiveMapUser | null>(null);
  const [history, setHistory] = useState<LocationFix[]>([]);
  const [range, setRange] = useState("24h");
  const [playing, setPlaying] = useState(false);
  const [playIndex, setPlayIndex] = useState(-1);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const historyRouteRef = useRef<L.Polyline | null>(null);
  const playbackMarkerRef = useRef<L.CircleMarker | null>(null);
  const deviceToUserRef = useRef<Map<string, string>>(new Map());
  const socketRef = useRef<Socket | null>(null);
  const playTimerRef = useRef<number | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter((u) => {
      if (sharingOnly && !u.sharing) return false;
      if (onlineOnly && !u.online) return false;
      if (q && !(u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q))) return false;
      return u.latitude !== null && u.longitude !== null;
    });
  }, [users, search, sharingOnly, onlineOnly]);

  const load = useCallback(async () => {
    try {
      const { users: live } = await api.getLiveMap();
      setUsers(live);
      deviceToUserRef.current = new Map(
        live.filter((u) => u.deviceId).map((u) => [u.deviceId as string, u.userId])
      );
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Failed to load live map");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  // Realtime updates: coords, presence, monitoring state.
  useEffect(() => {
    const socket = connectLocationSocket({
      onLocationUpdate: (payload) => {
        const userId = deviceToUserRef.current.get(payload.deviceId);
        if (!userId) return;
        setUsers((prev) =>
          prev.map((u) =>
            u.userId === userId
              ? {
                  ...u,
                  latitude: payload.latitude,
                  longitude: payload.longitude,
                  accuracy: payload.accuracy,
                  lastFixAt: payload.timestamp,
                  lastSeenAt: payload.timestamp,
                  online: true,
                  sharing: true,
                }
              : u
          )
        );
      },
    });
    socket.on("user:connected", (payload: { userId: string }) => {
      setUsers((prev) => prev.map((u) => (u.userId === payload.userId ? { ...u, online: true } : u)));
    });
    socket.on("user:disconnected", (payload: { userId: string }) => {
      setUsers((prev) => prev.map((u) => (u.userId === payload.userId ? { ...u, online: false } : u)));
    });
    socket.on("admin:monitor-started", (payload: { userId: string }) => {
      setUsers((prev) => prev.map((u) => (u.userId === payload.userId ? { ...u, monitoringStatus: "ACTIVE" } : u)));
    });
    socket.on("admin:monitor-stopped", (payload: { userId: string }) => {
      setUsers((prev) => prev.map((u) => (u.userId === payload.userId ? { ...u, monitoringStatus: "INACTIVE" } : u)));
    });
    socket.on("admin:user-suspended", (payload: { userId: string }) => {
      setUsers((prev) => prev.map((u) => (u.userId === payload.userId ? { ...u, monitoringStatus: "SUSPENDED" } : u)));
    });
    socketRef.current = socket;
    return () => {
      disconnectLocationSocket(socket);
      socketRef.current = null;
    };
  }, []);

  // Init map once.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, { zoomControl: true, attributionControl: true, center: [20, 0], zoom: 2 });
    mapRef.current = map;
    L.tileLayer(DARK_TILE_URL, {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
      subdomains: "abcd",
      maxZoom: 19,
    }).addTo(map);
    const layer = L.layerGroup();
    layer.addTo(map);
    layerRef.current = layer;
    const route = L.polyline([], { color: "#22d3ee", weight: 3, opacity: 0.85, dashArray: "6 6" });
    route.addTo(map);
    historyRouteRef.current = route;
    const playback = L.circleMarker([0, 0], { radius: 7, color: "#fff", weight: 2, fillColor: "#22d3ee", fillOpacity: 1 });
    playback.addTo(map).setLatLng([0, 0]).setStyle({ opacity: 0 });
    playbackMarkerRef.current = playback;

    const onResize = () => map.invalidateSize();
    window.addEventListener("resize", onResize);
    const t = window.setTimeout(() => map.invalidateSize(), 0);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("resize", onResize);
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
      historyRouteRef.current = null;
      playbackMarkerRef.current = null;
    };
  }, []);

  const [bump, setBump] = useState(0);

  const renderMarkers = useCallback(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();

    const zoom = map.getZoom();
    const cell = cellSizeForZoom(zoom);
    const groups = new Map<string, LiveMapUser[]>();
    for (const u of filtered) {
      if (u.latitude === null || u.longitude === null) continue;
      const key = cellKey(u.latitude, u.longitude, cell);
      const arr = groups.get(key) ?? [];
      arr.push(u);
      groups.set(key, arr);
    }

    for (const members of groups.values()) {
      const isCluster = members.length > 1;
      const lat = members.reduce((s, m) => s + (m.latitude ?? 0), 0) / members.length;
      const lng = members.reduce((s, m) => s + (m.longitude ?? 0), 0) / members.length;

      if (isCluster) {
        const m = L.marker([lat, lng], {
          icon: L.divIcon({ className: "", html: `<div class="cluster-badge">${members.length}</div>`, iconSize: [30, 30], iconAnchor: [15, 15] }),
        });
        m.bindTooltip(`${members.length} users`, { direction: "top", opacity: 0.95 });
        m.on("click", () => map.setView([lat, lng], Math.min(zoom + 2, 19)));
        m.addTo(layer);
      } else {
        const u = members[0];
        const isSelected = selected?.userId === u.userId;
        const m = L.marker([lat, lng], {
          icon: L.divIcon({
            className: "",
            html: `<div class="${isSelected ? "live-pin" : u.sharing ? "live-dot" : "off-dot"}"><span class="${isSelected ? "live-pin-core" : u.sharing ? "live-dot-core" : "off-dot-core"}"></span></div>`,
            iconSize: isSelected ? [22, 22] : [12, 12],
            iconAnchor: isSelected ? [11, 11] : [6, 6],
          }),
        });
        m.bindTooltip(
          `${u.name}<br/>${u.email}<br/>${u.latitude?.toFixed(5)}, ${u.longitude?.toFixed(5)}<br/>${u.sharing ? "sharing" : "not sharing"} · ${u.monitoringStatus}`,
          { direction: "top", opacity: 0.95 }
        );
        m.on("click", () => setSelected(u));
        m.addTo(layer);
        if (u.accuracy && u.accuracy > 0 && u.sharing) {
          L.circle([lat, lng], {
            radius: Math.max(2, u.accuracy),
            color: "#22d3ee",
            weight: 1,
            opacity: 0.4,
            fillColor: "#22d3ee",
            fillOpacity: 0.08,
            interactive: false,
          }).addTo(layer);
        }
      }
    }

    if (filtered.length > 0 && !selected) {
      const bounds: L.LatLngBounds | null = filtered.reduce<L.LatLngBounds | null>((acc, u) => {
        if (u.latitude === null || u.longitude === null) return acc;
        const pt = L.latLng(u.latitude, u.longitude);
        return acc ? acc.extend(pt) : L.latLngBounds(pt, pt);
      }, null);
      if (bounds) map.fitBounds(bounds.pad(0.3), { maxZoom: 14 });
    }
  }, [filtered, selected]);

  // Rebuild markers when data/selection changes or zoom changes.
  useEffect(() => {
    renderMarkers();
  }, [renderMarkers, bump]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const handler = () => setBump((b) => b + 1);
    map.on("zoomend", handler);
    return () => {
      map.off("zoomend", handler);
    };
  }, []);

  // Load history for the selected user.
  useEffect(() => {
    if (!selected) {
      setHistory([]);
      setPlaying(false);
      setPlayIndex(-1);
      if (historyRouteRef.current) historyRouteRef.current.setLatLngs([]);
      return;
    }
    void api
      .getUserLocationHistory(selected.userId, { range })
      .then((h) => {
        setHistory(h.items);
        setPlayIndex(-1);
        setPlaying(false);
        if (historyRouteRef.current) {
          historyRouteRef.current.setLatLngs(h.items.map((f) => [f.latitude, f.longitude] as [number, number]));
        }
        const map = mapRef.current;
        if (map && h.items.length > 0) {
          const bounds = L.latLngBounds(h.items.map((f) => [f.latitude, f.longitude] as [number, number]));
          if (h.items.length > 1) map.fitBounds(bounds.pad(0.2), { maxZoom: 16 });
          else map.setView([h.items[0].latitude, h.items[0].longitude], 15);
        }
      })
      .catch(() => {
        setHistory([]);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, range]);

  // Playback stepping.
  useEffect(() => {
    if (!playing) {
      if (playTimerRef.current) window.clearInterval(playTimerRef.current);
      playTimerRef.current = null;
      return;
    }
    playTimerRef.current = window.setInterval(() => {
      setPlayIndex((i) => {
        const next = i + 1;
        if (history.length === 0) return -1;
        if (next >= history.length) {
          setPlaying(false);
          return -1;
        }
        return next;
      });
    }, 800);
    return () => {
      if (playTimerRef.current) window.clearInterval(playTimerRef.current);
      playTimerRef.current = null;
    };
  }, [playing, history.length]);

  useEffect(() => {
    const marker = playbackMarkerRef.current;
    if (!marker) return;
    if (playIndex >= 0 && history[playIndex]) {
      const f = history[playIndex];
      marker.setLatLng([f.latitude, f.longitude]);
      marker.setStyle({ opacity: 1 });
      const map = mapRef.current;
      if (map && playIndex > 0) map.panTo([f.latitude, f.longitude]);
    } else {
      marker.setStyle({ opacity: 0 });
    }
  }, [playIndex, history]);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner label="Loading live map…" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-mono text-xl font-semibold text-slate-100">Live map</h1>
          <p className="mt-1 text-sm text-slate-500">{filtered.length} users with a recorded fix</p>
        </div>
        <Button variant="ghost" className="text-xs" onClick={() => void load()}>
          Refresh
        </Button>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <input className="input md:col-span-2" type="search" placeholder="Search name or email…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <div className="flex items-center gap-4 rounded-lg border border-ink-700 bg-ink-850 px-3 text-xs text-slate-300">
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={sharingOnly} onChange={(e) => setSharingOnly(e.target.checked)} className="accent-cyan-400" />
            Sharing only
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={onlineOnly} onChange={(e) => setOnlineOnly(e.target.checked)} className="accent-cyan-400" />
            Online only
          </label>
        </div>
        <select className="input" value={range} onChange={(e) => setRange(e.target.value)}>
          <option value="1h">History: last hour</option>
          <option value="6h">History: last 6 hours</option>
          <option value="24h">History: last 24 hours</option>
          <option value="7d">History: last 7 days</option>
        </select>
      </div>

      <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
        <div className="panel max-h-[560px] overflow-y-auto scroll-thin">
          <div className="border-b border-ink-700 px-4 py-3 panel-title">Users</div>
          <div className="divide-y divide-ink-800">
            {filtered.length === 0 && (
              <div className="px-4 py-8 text-center text-xs text-slate-500">No users match the filters.</div>
            )}
            {filtered.map((u) => (
              <button
                key={u.userId}
                onClick={() => setSelected(u)}
                className={`block w-full px-4 py-3 text-left transition hover:bg-ink-850 ${selected?.userId === u.userId ? "bg-ink-850" : ""}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm text-slate-200">{u.name}</span>
                  <span className={`h-2 w-2 shrink-0 rounded-full ${u.online ? "bg-signal" : "bg-slate-600"}`} />
                </div>
                <div className="mt-0.5 truncate text-[11px] text-slate-500">{u.email}</div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  {u.sharing && <span className="badge bg-accent/15 text-accent-soft">sharing</span>}
                  {u.monitoringStatus !== "INACTIVE" && (
                    <span className={`badge ${u.monitoringStatus === "SUSPENDED" ? "bg-signal-warn/15 text-signal-warn" : "bg-signal/15 text-signal"}`}>
                      {u.monitoringStatus}
                    </span>
                  )}
                  {u.lastFixAt && <span className="text-[10px] text-slate-600">{timeAgo(u.lastFixAt)}</span>}
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <Card title={selected ? `${selected.name} — live & history` : "Live positions"} className="grow">
            <div className="h-[480px]">
              <div ref={containerRef} className="h-full w-full rounded-xl border border-ink-700 bg-ink-900" aria-label="Admin live map" />
            </div>
            {selected && history.length > 0 && (
              <div className="mt-3 flex items-center gap-3 rounded-lg border border-ink-700 bg-ink-850 px-3 py-2">
                <Button
                  variant="ghost"
                  className="text-xs"
                  onClick={() => {
                    if (!playing && playIndex < 0) setPlayIndex(0);
                    setPlaying(!playing);
                  }}
                >
                  {playing ? "Pause" : "Play"}
                </Button>
                <div className="h-1 flex-1 overflow-hidden rounded bg-ink-700">
                  <div
                    className="h-full bg-accent transition-all"
                    style={{ width: `${history.length > 0 ? ((playIndex + 1) / history.length) * 100 : 0}%` }}
                  />
                </div>
                <span className="font-mono text-[11px] text-slate-400">
                  {playIndex + 1}/{history.length} fixes
                </span>
              </div>
            )}
            {selected && (
              <div className="mt-2 text-xs text-slate-500">
                {selected.sharing ? "Sharing live" : "Not sharing"} · permission {selected.permissionStatus} · monitoring{" "}
                {selected.monitoringStatus}
              </div>
            )}
          </Card>
        </div>
      </div>

      <style>{`
        .live-pin { position: relative; width: 22px; height: 22px; }
        .live-pin-core {
          position: absolute; inset: 5px; border-radius: 9999px;
          background: #22d3ee; box-shadow: 0 0 0 4px rgba(34,211,238,0.35), 0 0 12px rgba(34,211,238,0.9);
          animation: livePinPulse 1.6s ease-in-out infinite;
        }
        .live-dot { position: relative; width: 12px; height: 12px; }
        .live-dot-core {
          position: absolute; inset: 2px; border-radius: 9999px;
          background: #22d3ee; box-shadow: 0 0 0 3px rgba(34,211,238,0.25), 0 0 8px rgba(34,211,238,0.6);
          opacity: 0.85;
        }
        .off-dot { position: relative; width: 10px; height: 10px; }
        .off-dot-core {
          position: absolute; inset: 2px; border-radius: 9999px;
          background: #475569; box-shadow: 0 0 0 2px rgba(71,85,105,0.35);
        }
        .cluster-badge {
          width: 30px; height: 30px; border-radius: 9999px;
          display: flex; align-items: center; justify-content: center;
          background: rgba(14,165,233,0.25); border: 2px solid #22d3ee; color: #67e8f9;
          font-family: monospace; font-size: 11px; font-weight: 600;
          box-shadow: 0 0 12px rgba(34,211,238,0.6);
        }
        @keyframes livePinPulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.5); }
        }
        .leaflet-container { background: #0a0f1a; font-family: inherit; }
        .leaflet-bar a { background: #0d1422; color: #67e8f9; border-color: #182338; }
        .leaflet-bar a:hover { background: #111a2c; }
        .leaflet-control-attribution { background: rgba(7,11,18,0.7) !important; color: #475569 !important; }
        .leaflet-control-attribution a { color: #67e8f9 !important; }
        .leaflet-tooltip { background: #0d1422; border: 1px solid #182338; color: #cbd5e1; font-family: inherit; }
        .leaflet-tooltip-top::before { border-top-color: #182338; }
      `}</style>
    </div>
  );
}