import { describe, expect, it } from "vitest";
import { httpRequest, HttpError } from "../../src/lib/httpClient";

describe("httpRequest", () => {
  it("returns parsed JSON for 2xx", async () => {
    const result = await httpRequest<{ hello: string }>({ url: "https://httpbin.org/json", maxRetries: 0, timeoutMs: 8000 });
    expect(result.status).toBe(200);
  });

  it("throws HttpError for non-2xx without retrying on 4xx", async () => {
    await expect(httpRequest({ url: "https://httpbin.org/status/400", maxRetries: 0, timeoutMs: 8000 })).rejects.toBeInstanceOf(HttpError);
  });

  it("times out on unreachable hosts", async () => {
    await expect(
      httpRequest({ url: "https://192.0.2.1:9/", maxRetries: 0, timeoutMs: 1500 })
    ).rejects.toBeDefined();
  });

  it("does not follow redirects by default", async () => {
    const res = await httpRequest<unknown>({
      url: "https://httpbin.org/redirect/1",
      maxRetries: 0,
      timeoutMs: 8000,
      allowedStatuses: [302],
    });
    expect(res.status).toBe(302);
  });
});
