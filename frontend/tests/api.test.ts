import { describe, expect, it, vi, afterEach } from "vitest";
import { api, ApiError, deviceHeaders } from "../src/lib/api";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("api client", () => {
  it("throws ApiError with the server message on failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "Invalid email address format" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        })
      )
    );
    await expect(api.createInvestigation("EMAIL", "bad")).rejects.toMatchObject({
      name: "ApiError",
      status: 400,
      message: "Invalid email address format",
    });
  });

  it("sends the bearer token and parses JSON on success", async () => {
    localStorage.setItem("sentinel.token", "tok-123");
    const body = { id: "inv-1", status: "RUNNING" };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(body), { status: 202, headers: { "Content-Type": "application/json" } })
      )
    );
    const result = await api.createInvestigation("IP", "8.8.8.8");
    expect(result.id).toBe("inv-1");
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("/api/investigations");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok-123");
  });

  it("clears the token on 401", async () => {
    localStorage.setItem("sentinel.token", "expired");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "Invalid token" }), { status: 401 }))
    );
    await expect(api.me()).rejects.toBeInstanceOf(ApiError);
    expect(localStorage.getItem("sentinel.token")).toBeNull();
  });
});

describe("device & location api client", () => {
  it("builds device-token request headers", () => {
    const init = deviceHeaders("sentinel-device-abc");
    expect((init.headers as Record<string, string>)["X-Device-Token"]).toBe("sentinel-device-abc");
  });

  it("enrolls a device with POST /api/devices", async () => {
    const body = { deviceId: "dev-1", deviceToken: "sentinel-device-secret", name: "Phone" };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 201, headers: { "Content-Type": "application/json" } }))
    );
    const result = await api.enrollDevice("Phone", "ANDROID");
    expect(result.deviceToken).toMatch(/^sentinel-device-/);
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("/api/devices");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ name: "Phone", platform: "ANDROID" });
  });

  it("fetches location status", async () => {
    localStorage.setItem("sentinel.token", "jwt-1");
    const body = {
      status: {
        deviceId: "dev-1",
        sharing: "LIVE",
        online: true,
        lastKnown: { latitude: 18.52, longitude: 73.85, accuracy: 8, altitude: null, speed: 0, heading: null, timestamp: "2026-08-12T00:00:00.000Z" },
        lastUpdated: "2026-08-12T00:00:00.000Z",
        offlineDurationMs: 0,
        session: null,
        consent: null,
      },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } }))
    );
    const { status } = await api.deviceStatus("dev-1");
    expect(status.sharing).toBe("LIVE");
    expect(status.lastKnown?.latitude).toBe(18.52);
    const [url] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("/api/devices/dev-1/location/status");
  });

  it("queries history with query params", async () => {
    const body = { items: [], total: 0, range: "custom" };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } }))
    );
    await api.deviceHistory("dev-1", { range: "custom", from: "2026-08-01T00:00:00Z", to: "2026-08-02T00:00:00Z", max: 500 });
    const [url] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe(
      "/api/devices/dev-1/location/history?range=custom&from=2026-08-01T00%3A00%3A00Z&to=2026-08-02T00%3A00%3A00Z&max=500"
    );
  });

  it("pushes a fix with the device token header", async () => {
    const fix = { latitude: 18.52, longitude: 73.85, accuracy: 5, altitude: 100, speed: 0, heading: 0, timestamp: "2026-08-12T00:00:00.000Z" };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "evt-1", timestamp: fix.timestamp }), { status: 201, headers: { "Content-Type": "application/json" } }))
    );
    const result = await api.devicePush("tok-secret", "dev-1", fix);
    expect(result.id).toBe("evt-1");
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("/api/devices/dev-1/location");
    expect((init.headers as Record<string, string>)["X-Device-Token"]).toBe("tok-secret");
    expect(JSON.parse(init.body)).toEqual(fix);
  });

  it("surfaces 403 consent errors from the api", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "Device consent required before location sharing can start" }), { status: 403 }))
    );
    await expect(api.deviceStart("tok", "dev-1", "NORMAL")).rejects.toMatchObject({
      name: "ApiError",
      status: 403,
      message: "Device consent required before location sharing can start",
    });
  });
});
