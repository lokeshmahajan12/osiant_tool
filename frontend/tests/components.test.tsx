import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConsentNotice } from "../src/components/ConsentNotice";
import { ResultCard } from "../src/components/ResultCard";
import { ConfidenceBar } from "../src/components/ui";
import type { ProviderResult } from "../src/types";

describe("ConsentNotice", () => {
  it("requires the checkbox before allowing acknowledgement", async () => {
    render(<ConsentNotice />);
    const button = screen.getByRole("button", { name: /acknowledge/i });
    expect(button).toBeDisabled();

    await userEvent.click(screen.getByRole("checkbox"));
    expect(button).toBeEnabled();
    await userEvent.click(button);
    expect(screen.getByText(/Acknowledged/)).toBeInTheDocument();
  });

  it("shows the authorization notice", () => {
    render(<ConsentNotice />);
    expect(screen.getByText(/authorized to investigate/i)).toBeInTheDocument();
  });
});

describe("ResultCard", () => {
  const result: ProviderResult = {
    provider: "hibp",
    category: "breach",
    status: "SUCCESS",
    dataType: "Breach Exposure",
    confidence: 0.95,
    timestamp: "2026-01-01T00:00:00.000Z",
    mode: "mock",
    data: {
      exposed: true,
      breaches: [{ name: "DemoBreach", domain: "demo.example", breachDate: "2023-01-01" }],
      leaked_password_hash: "deadbeef", // must never render
    },
  };

  it("renders provider name, status and confidence", () => {
    render(<ResultCard result={result} />);
    expect(screen.getByText("hibp")).toBeInTheDocument();
    expect(screen.getByText("SUCCESS")).toBeInTheDocument();
    expect(screen.getByText("mock")).toBeInTheDocument();
  });

  it("hides credential-like fields from the rendered data", () => {
    render(<ResultCard result={result} />);
    expect(screen.queryByText(/leaked_password_hash/i)).not.toBeInTheDocument();
    expect(screen.queryByText("deadbeef")).not.toBeInTheDocument();
  });

  it("shows error state when a provider fails", () => {
    render(<ResultCard result={{ ...result, status: "ERROR", data: null, error: "Provider quota exceeded" }} />);
    expect(screen.getByText("Provider quota exceeded")).toBeInTheDocument();
  });
});

describe("ConfidenceBar", () => {
  it("shows the percentage", () => {
    render(<ConfidenceBar value={0.7} />);
    expect(screen.getByText("70%")).toBeInTheDocument();
  });
});
