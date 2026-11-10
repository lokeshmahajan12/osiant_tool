import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { LiveMap, type LivePoint } from "../src/components/LiveMap";
import type { LocationFix } from "../src/types";

const h = vi.hoisted(() => {
  const fitBounds = vi.fn();
  const invalidateSize = vi.fn();
  const setLatLngs = vi.fn();
  const setRadius = vi.fn();
  const removeLayer = vi.fn();
  const panTo = vi.fn();
  const contains = vi.fn(() => true);
  const getBounds = vi.fn(() => ({ contains }));
  const markerInstances: Array<{
    latlng: unknown;
    setLatLng: ReturnType<typeof vi.fn>;
    setIcon: ReturnType<typeof vi.fn>;
    bindTooltip: ReturnType<typeof vi.fn>;
    setTooltipContent: ReturnType<typeof vi.fn>;
    addTo: ReturnType<typeof vi.fn>;
  }> = [];
  const tileInstances: Array<{
    url: string;
    addTo: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
    handlers: Record<string, (arg?: unknown) => void>;
  }> = [];
  return { fitBounds, invalidateSize, setLatLngs, setRadius, removeLayer, panTo, contains, getBounds, markerInstances, tileInstances };
});

vi.mock("leaflet", () => ({
  default: {
    map: () => ({
      fitBounds: h.fitBounds,
      invalidateSize: h.invalidateSize,
      removeLayer: h.removeLayer,
      remove: vi.fn(),
      panTo: h.panTo,
      getBounds: h.getBounds,
    }),
    tileLayer: (url: string) => {
      // Real Leaflet's addTo() returns the layer itself, which the component
      // relies on when swapping the basemap.
      const handlers: Record<string, (arg?: unknown) => void> = {};
      const t = {
        url,
        addTo: vi.fn(),
        remove: vi.fn(),
        on: vi.fn((event: string, cb: (arg?: unknown) => void) => {
          handlers[event] = cb;
        }),
        handlers,
      };
      t.addTo.mockReturnValue(t);
      h.tileInstances.push(t);
      return t;
    },
    polyline: () => ({ addTo: vi.fn(), setLatLngs: h.setLatLngs }),
    circle: () => ({ addTo: vi.fn(), setLatLng: vi.fn(), setRadius: h.setRadius }),
    divIcon: () => ({}),
    marker: (latlng: unknown, _opts: unknown) => {
      const m = {
        latlng,
        setLatLng: vi.fn(),
        setIcon: vi.fn(),
        bindTooltip: vi.fn(),
        setTooltipContent: vi.fn(),
        addTo: vi.fn(),
      };
      h.markerInstances.push(m);
      return m;
    },
    latLng: (lat: number, lng: number) => ({ lat, lng }),
    latLngBounds: () => ({
      extend: () => ({ pad: () => ({}) }),
      pad: () => ({}),
    }),
  },
}));

const pt = (id: string, lat: number, lng: number, isSelected = false): LivePoint => ({
  id,
  label: `Device ${id}`,
  latitude: lat,
  longitude: lng,
  accuracy: 12,
  isSelected,
});

const fix = (lat: number, lng: number, t: number): LocationFix => ({
  latitude: lat,
  longitude: lng,
  accuracy: 12,
  altitude: null,
  speed: null,
  heading: null,
  timestamp: new Date(t).toISOString(),
});

beforeEach(() => {
  vi.clearAllMocks();
  h.markerInstances.length = 0;
  h.tileInstances.length = 0;
});

describe("LiveMap", () => {
  it("renders one marker per live point and fits to all of them", async () => {
    render(<LiveMap points={[pt("a", 1, 2, true), pt("b", 3, 4)]} history={[]} fitKey="a" />);
    await new Promise((r) => setTimeout(r, 0));
    expect(h.markerInstances).toHaveLength(2);
    expect(h.fitBounds).toHaveBeenCalledTimes(1);
    expect(h.setRadius).toHaveBeenCalledWith(12);
  });

  it("updates a marker position without re-fitting for the same device", async () => {
    const { rerender } = render(<LiveMap points={[pt("a", 1, 2, true)]} history={[]} fitKey="a" />);
    await new Promise((r) => setTimeout(r, 0));
    const marker = h.markerInstances[0];
    marker.setLatLng.mockClear();
    h.fitBounds.mockClear();

    rerender(<LiveMap points={[pt("a", 5, 6, true)]} history={[]} fitKey="a" />);
    expect(marker.setLatLng).toHaveBeenCalledWith([5, 6]);
    expect(h.fitBounds).not.toHaveBeenCalled();
  });

  it("re-fits the map when the selected device changes", async () => {
    const { rerender } = render(<LiveMap points={[pt("a", 1, 2, true)]} history={[]} fitKey="a" />);
    await new Promise((r) => setTimeout(r, 0));
    h.fitBounds.mockClear();

    rerender(<LiveMap points={[pt("b", 3, 4, true)]} history={[]} fitKey="b" />);
    expect(h.fitBounds).toHaveBeenCalledTimes(1);
  });

  it("removes the marker when a device stops sharing", async () => {
    const { rerender } = render(<LiveMap points={[pt("a", 1, 2, true), pt("b", 3, 4)]} history={[]} fitKey="a" />);
    await new Promise((r) => setTimeout(r, 0));
    h.removeLayer.mockClear();

    rerender(<LiveMap points={[pt("a", 1, 2, true)]} history={[]} fitKey="a" />);
    expect(h.removeLayer).toHaveBeenCalledTimes(1);
  });

  it("pans the map when the selected device moves outside the viewport", async () => {
    h.contains.mockReturnValue(false);
    const { rerender } = render(<LiveMap points={[pt("a", 1, 2, true)]} history={[]} fitKey="a" />);
    await new Promise((r) => setTimeout(r, 0));
    h.panTo.mockClear();

    rerender(<LiveMap points={[pt("a", 10, 20, true)]} history={[]} fitKey="a" />);
    expect(h.panTo).toHaveBeenCalledWith({ lat: 10, lng: 20 }, { animate: true });
    h.contains.mockReturnValue(true);
  });

  it("does not pan while the selected device stays inside the viewport", async () => {
    h.contains.mockReturnValue(true);
    const { rerender } = render(<LiveMap points={[pt("a", 1, 2, true)]} history={[]} fitKey="a" />);
    await new Promise((r) => setTimeout(r, 0));
    h.panTo.mockClear();

    rerender(<LiveMap points={[pt("a", 1.001, 2.001, true)]} history={[]} fitKey="a" />);
    expect(h.panTo).not.toHaveBeenCalled();
  });

  it("shows the empty-data overlay when neither points nor history exist", () => {
    render(<LiveMap points={[]} history={[]} />);
    expect(screen.getByText(/No location data recorded yet/)).toBeInTheDocument();
  });

  it("shows the historical-fixes note instead of the empty overlay when history exists", () => {
    render(<LiveMap points={[]} history={[fix(1, 2, 1000), fix(3, 4, 2000)]} />);
    expect(screen.getByText(/Showing the last 2 recorded fixes/)).toBeInTheDocument();
    expect(screen.queryByText(/No location data recorded yet/)).not.toBeInTheDocument();
  });

  it("shows no overlay once a live point is present", () => {
    render(<LiveMap points={[pt("a", 1, 2, true)]} history={[]} />);
    expect(screen.queryByText(/No location data recorded yet/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Showing the last/)).not.toBeInTheDocument();
  });

  it("defaults to the dark CARTO basemap", async () => {
    render(<LiveMap points={[]} history={[]} />);
    await new Promise((r) => setTimeout(r, 0));
    expect(h.tileInstances).toHaveLength(1);
    expect(h.tileInstances[0].url).toContain("/dark_all/");
  });

  it("renders the Voyager raster basemap for the voyager style", async () => {
    render(<LiveMap points={[]} history={[]} style="voyager" />);
    await new Promise((r) => setTimeout(r, 0));
    expect(h.tileInstances).toHaveLength(1);
    expect(h.tileInstances[0].url).toContain("/rastertiles/voyager/");
  });

  it("signs every basemap request with the configured CARTO key", async () => {
    render(<LiveMap points={[]} history={[]} style="voyager" />);
    await new Promise((r) => setTimeout(r, 0));
    const url = h.tileInstances[0].url;
    expect(url.startsWith("https://")).toBe(true);
    // Without a key the CDN answers 200 with a blank tile, so the key is what
    // makes the raster actually render.
    if (process.env.VITE_CARTO_API_KEY) {
      expect(url).toContain("?key=");
      expect(url.endsWith(process.env.VITE_CARTO_API_KEY)).toBe(true);
    }
  });

  it("surfaces a visible notice when basemap tiles fail to load", async () => {
    render(<LiveMap points={[]} history={[]} />);
    await new Promise((r) => setTimeout(r, 0));

    await act(async () => {
      h.tileInstances[0].handlers.tileerror?.();
    });
    expect(screen.getByText(/Basemap tiles failed to load/)).toBeInTheDocument();
  });

  it("clears the failure notice once a tile loads", async () => {
    render(<LiveMap points={[]} history={[]} />);
    await new Promise((r) => setTimeout(r, 0));

    await act(async () => {
      h.tileInstances[0].handlers.tileerror?.();
    });
    expect(screen.getByText(/Basemap tiles failed to load/)).toBeInTheDocument();

    await act(async () => {
      h.tileInstances[0].handlers.tileload?.();
    });
    expect(screen.queryByText(/Basemap tiles failed to load/)).not.toBeInTheDocument();
  });

  it("swaps the basemap layer in place when the style changes", async () => {
    const { rerender } = render(<LiveMap points={[pt("a", 1, 2, true)]} history={[]} fitKey="a" />);
    await new Promise((r) => setTimeout(r, 0));
    const first = h.tileInstances[0];

    rerender(<LiveMap points={[pt("a", 1, 2, true)]} history={[]} fitKey="a" style="voyager" />);
    await new Promise((r) => setTimeout(r, 0));

    expect(first.remove).toHaveBeenCalled();
    expect(h.tileInstances).toHaveLength(2);
    expect(h.tileInstances[1].url).toContain("/rastertiles/voyager/");
    expect(h.markerInstances).toHaveLength(1);
    expect(h.fitBounds).toHaveBeenCalledTimes(1);
  });
});
