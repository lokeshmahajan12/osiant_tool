import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { LocationFix } from "../types";

export interface LivePoint {
  id: string;
  label: string;
  latitude: number;
  longitude: number;
  accuracy: number;
  isSelected?: boolean;
}

export type MapStyle = "dark" | "voyager";

interface LiveMapProps {
  /**
   * Every device to show on the map: the selected device's fix (live or last
   * known) plus the live fixes of all other sharing devices.
   */
  points: LivePoint[];
  /** Historical fixes rendered as a route polyline (real recorded points). */
  history: LocationFix[];
  /** Changes whenever the selected device changes, triggering a re-fit. */
  fitKey?: string;
  /** CARTO raster basemap to render. Defaults to the dark basemap. */
  style?: MapStyle;
}

const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>';

const DARK_TILE_URL = "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";
const VOYAGER_TILE_URL = "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png";

/**
 * CARTO basemap key. It is a public client-side basemap credential (it has to
 * be, since the browser fetches the rasters directly), so it lives in a
 * `VITE_`-prefixed var and is only ever used to sign tile requests.
 *
 * Both basemaps need it: without a key the CDN still answers 200, but with a
 * blank tile carrying a small "no key" badge, which reads as an empty map.
 */
const metaEnv = (import.meta as unknown as { env?: { VITE_CARTO_API_KEY?: string } }).env;
const CARTO_API_KEY = metaEnv?.VITE_CARTO_API_KEY?.trim() ?? "";

function signedTileUrl(url: string): string {
  return CARTO_API_KEY ? `${url}?key=${encodeURIComponent(CARTO_API_KEY)}` : url;
}

function tileUrl(style: MapStyle): string {
  return signedTileUrl(style === "voyager" ? VOYAGER_TILE_URL : DARK_TILE_URL);
}

/**
 * Leaflet map used by the live-location dashboard. One pin is rendered per
 * actively sharing device (plus the selected device's last known position),
 * so every live location is visible regardless of which device is selected.
 * Pins are only ever placed on coordinates the backend received from the
 * device's OS location API; a CSS transition on the pin animates movement
 * between real fixes without inventing intermediate GPS points.
 */
export function LiveMap({ points, history, fitKey = "", style = "dark" }: LiveMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileRef = useRef<L.TileLayer | null>(null);
  const markersRef = useRef<Map<string, L.Marker>>(new Map());
  const circleRef = useRef<L.Circle | null>(null);
  const routeRef = useRef<L.Polyline | null>(null);
  const fittedForRef = useRef<string | null>(null);
  const seenPointsRef = useRef<Set<string>>(new Set());
  const [tileStatus, setTileStatus] = useState<"loading" | "ok" | "error">("loading");

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      zoomControl: true,
      attributionControl: true,
      center: [20, 0],
      zoom: 2,
    });
    mapRef.current = map;

    const route = L.polyline([], { color: "#22d3ee", weight: 3, opacity: 0.85, dashArray: "6 6" });
    route.addTo(map);
    routeRef.current = route;

    const circle = L.circle([20, 0], {
      radius: 1,
      color: "#22d3ee",
      weight: 1,
      opacity: 0.5,
      fillColor: "#22d3ee",
      fillOpacity: 0.1,
    });
    circle.addTo(map);
    circleRef.current = circle;

    const onResize = () => map.invalidateSize();
    window.addEventListener("resize", onResize);
    const readyTimer = window.setTimeout(() => map.invalidateSize(), 0);

    return () => {
      window.clearTimeout(readyTimer);
      window.removeEventListener("resize", onResize);
      map.remove();
      mapRef.current = null;
      tileRef.current = null;
      markersRef.current.clear();
      circleRef.current = null;
      routeRef.current = null;
      fittedForRef.current = null;
      seenPointsRef.current.clear();
    };
  }, []);

  // Basemap raster. Re-added on change so switching styles keeps the current
  // viewport, pins and route exactly where the user left them.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    setTileStatus("loading");
    tileRef.current?.remove();

    const layer = L.tileLayer(tileUrl(style), {
      attribution: TILE_ATTRIBUTION,
      subdomains: "abcd",
      maxZoom: 19,
    });

    // A keyless CARTO request returns HTTP 200 with a blank tile, so a missing
    // key cannot be detected from the response — it just looks like an empty
    // map. Surface it instead of failing silently.
    layer.on("tileload", () => setTileStatus((s) => (s === "ok" ? s : "ok")));
    layer.on("tileerror", () => setTileStatus("error"));

    layer.addTo(map);
    tileRef.current = layer;
    return () => {
      layer.remove();
      if (tileRef.current === layer) tileRef.current = null;
    };
  }, [style]);

  // Keep pins + accuracy circle in sync with the device fixes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const markers = markersRef.current;

    const present = new Set(points.map((p) => p.id));
    for (const [id, m] of markers) {
      if (!present.has(id)) {
        map.removeLayer(m);
        markers.delete(id);
      }
    }

    let newDeviceSeen = false;
    for (const p of points) {
      if (!seenPointsRef.current.has(p.id)) newDeviceSeen = true;
      seenPointsRef.current.add(p.id);
    }

    for (const p of points) {
      const latLng: L.LatLngExpression = [p.latitude, p.longitude];
      const icon = p.isSelected ? selectedIcon() : liveDotIcon();
      const existing = markers.get(p.id);
      if (existing) {
        existing.setLatLng(latLng);
        existing.setIcon(icon);
        existing.setTooltipContent(tooltipFor(p));
      } else {
        const m = L.marker(latLng, { icon, interactive: true });
        m.bindTooltip(tooltipFor(p), { direction: "top", opacity: 0.95 });
        m.addTo(map);
        markers.set(p.id, m);
      }
    }

    const selected = points.find((p) => p.isSelected);
    if (selected && circleRef.current) {
      circleRef.current.setLatLng([selected.latitude, selected.longitude]);
      circleRef.current.setRadius(Math.max(2, selected.accuracy));
    }

    if (points.length === 0) return;
    if (fittedForRef.current !== fitKey || newDeviceSeen) {
      let bounds: L.LatLngBounds | null = null;
      for (const p of points) {
        const pt = L.latLng(p.latitude, p.longitude);
        bounds = bounds ? bounds.extend(pt) : L.latLngBounds(pt, pt);
      }
      if (bounds) map.fitBounds(bounds.pad(0.25), { maxZoom: 16 });
      fittedForRef.current = fitKey;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, fitKey]);

  // History route for the selected device.
  useEffect(() => {
    if (!routeRef.current) return;
    routeRef.current.setLatLngs(
      history.length > 0 ? history.map((f) => [f.latitude, f.longitude] as [number, number]) : []
    );
  }, [history]);

  // Follow the selected device: if its pin moves outside the current viewport
  // (e.g. the user is traveling), pan the map so it always stays visible.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const selected = points.find((p) => p.isSelected);
    if (!selected) return;
    if (typeof map.getBounds !== "function" || typeof map.panTo !== "function") return;
    const view = map.getBounds();
    const latLng = L.latLng(selected.latitude, selected.longitude);
    if (!view.contains(latLng)) {
      map.panTo(latLng, { animate: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points]);

  // Re-measure the container whenever the selected device changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const t = window.setTimeout(() => map.invalidateSize(), 0);
    return () => window.clearTimeout(t);
  }, [fitKey]);

  return (
    <div className="relative h-full w-full overflow-hidden rounded-xl border border-ink-700 bg-ink-900">
      <div ref={containerRef} className="h-full w-full" aria-label="Live location map" />
      {points.length === 0 && history.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-4">
          <div className="max-w-sm rounded-lg border border-ink-700 bg-ink-950/85 px-4 py-2 text-center font-mono text-xs text-slate-400">
            No location data recorded yet. A pin and route appear here once this device reports a GPS fix.
          </div>
        </div>
      )}
      {points.length === 0 && history.length > 0 && (
        <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center p-3">
          <div className="rounded-lg border border-ink-700 bg-ink-950/85 px-3 py-1.5 font-mono text-[11px] text-slate-400">
            Showing the last {history.length} recorded fix{history.length === 1 ? "" : "es"} — no current fix
          </div>
        </div>
      )}
      {tileStatus === "error" && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center p-3">
          <div className="rounded-lg border border-signal-warn/40 bg-ink-950/90 px-3 py-2 text-center font-mono text-[11px] text-signal-warn">
            Basemap tiles failed to load
            {CARTO_API_KEY ? " — the CARTO key may be invalid or out of quota." : " — set VITE_CARTO_API_KEY in .env and restart the dev server."}
            Device positions below are still accurate.
          </div>
        </div>
      )}
      {tileStatus !== "error" && !CARTO_API_KEY && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center p-3">
          <div className="rounded-lg border border-ink-700 bg-ink-950/90 px-3 py-1.5 text-center font-mono text-[11px] text-slate-400">
            Basemap key not configured — set VITE_CARTO_API_KEY in .env
          </div>
        </div>
      )}
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

let selectedIconCache: L.DivIcon | null = null;
function selectedIcon(): L.DivIcon {
  if (!selectedIconCache) {
    selectedIconCache = L.divIcon({
      className: "",
      html: '<div class="live-pin"><span class="live-pin-core"></span></div>',
      iconSize: [22, 22],
      iconAnchor: [11, 11],
    });
  }
  return selectedIconCache;
}

let dotIconCache: L.DivIcon | null = null;
function liveDotIcon(): L.DivIcon {
  if (!dotIconCache) {
    dotIconCache = L.divIcon({
      className: "",
      html: '<div class="live-dot"><span class="live-dot-core"></span></div>',
      iconSize: [12, 12],
      iconAnchor: [6, 6],
    });
  }
  return dotIconCache;
}

function tooltipFor(p: LivePoint): string {
  return `${p.label}<br/>${p.latitude.toFixed(5)}, ${p.longitude.toFixed(5)}`;
}
