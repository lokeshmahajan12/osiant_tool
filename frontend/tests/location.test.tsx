import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { LiveStatusBadge, OnlineBadge } from "../src/components/LiveStatusBadge";

describe("LiveStatusBadge", () => {
  it("shows LIVE state", () => {
    render(<LiveStatusBadge sharing="LIVE" />);
    expect(screen.getByText(/LIVE — Location sharing active/)).toBeInTheDocument();
  });

  it("shows OFF state", () => {
    render(<LiveStatusBadge sharing="OFF" />);
    expect(screen.getByText(/OFF — Location sharing stopped/)).toBeInTheDocument();
  });

  it("supports compact mode", () => {
    render(<LiveStatusBadge sharing="LIVE" compact />);
    expect(screen.getByText("LIVE")).toBeInTheDocument();
    expect(screen.queryByText(/Location sharing active/)).not.toBeInTheDocument();
  });
});

describe("OnlineBadge", () => {
  it("shows online state", () => {
    render(<OnlineBadge online />);
    expect(screen.getByText(/Online/)).toBeInTheDocument();
  });

  it("shows offline state", () => {
    render(<OnlineBadge online={false} />);
    expect(screen.getByText(/Device Offline/)).toBeInTheDocument();
  });
});
