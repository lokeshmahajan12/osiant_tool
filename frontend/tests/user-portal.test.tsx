import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Navigate } from "react-router-dom";
import { Register } from "../src/pages/Register";
import { RoleGate } from "../src/components/RoleGate";
import { ConfirmDialog } from "../src/components/ui";
import type { Role, User } from "../src/types";

const user: User = { id: "u1", email: "u@test.local", name: "U", role: "USER" };

vi.mock("../src/context/AuthContext", () => ({
  useAuth: vi.fn(),
}));

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return {
    ...actual,
    Navigate: ({ to }: { to: string }) => <div data-testid="navigate-to">{String(to)}</div>,
    useNavigate: () => navigateMock,
  };
});

import { useAuth } from "../src/context/AuthContext";

const navigateMock = vi.fn();

const mockedUseAuth = vi.mocked(useAuth);
let registerMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  registerMock = vi.fn().mockResolvedValue(undefined);
  mockedUseAuth.mockReturnValue({
    user: null,
    loading: false,
    login: vi.fn(),
    register: registerMock,
    logout: vi.fn(),
    refresh: vi.fn(),
  });
});

describe("Register", () => {
  it("blocks a weak password with a client-side error", async () => {
    render(
      <MemoryRouter>
        <Register />
      </MemoryRouter>
    );
    await userEvent.type(screen.getByPlaceholderText("Full name"), "Alice Doe");
    await userEvent.type(screen.getByPlaceholderText("Email address"), "alice@example.com");
    await userEvent.type(screen.getByPlaceholderText("Password (min 8: upper, lower, number)"), "weakpass");
    await userEvent.type(screen.getByPlaceholderText("Confirm password"), "weakpass");
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));

    expect(registerMock).toHaveBeenCalledTimes(0);
    expect(screen.getByText(/uppercase letter and a number/i)).toBeInTheDocument();
  });

  it("submits a valid registration payload", async () => {
    render(
      <MemoryRouter>
        <Register />
      </MemoryRouter>
    );
    await userEvent.type(screen.getByPlaceholderText("Full name"), "Alice Doe");
    await userEvent.type(screen.getByPlaceholderText("Username (optional)"), "alice_d");
    await userEvent.type(screen.getByPlaceholderText("Mobile (optional)"), "+919876543210");
    await userEvent.type(screen.getByPlaceholderText("Email address"), "alice@example.com");
    await userEvent.type(screen.getByPlaceholderText("Password (min 8: upper, lower, number)"), "AlicePass123");
    await userEvent.type(screen.getByPlaceholderText("Confirm password"), "AlicePass123");
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));

    expect(registerMock).toHaveBeenCalledTimes(1);
    expect(registerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "alice@example.com",
        username: "alice_d",
        mobile: "+919876543210",
        password: "AlicePass123",
        confirmPassword: "AlicePass123",
      })
    );
    expect(navigateMock).toHaveBeenCalledWith("/dashboard");
  });
});

describe("RoleGate", () => {
  it("renders children when the role is allowed", () => {
    mockedUseAuth.mockReturnValue({
      user,
      loading: false,
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
      refresh: vi.fn(),
    });
    render(
      <MemoryRouter>
        <RoleGate roles={["USER"]}>
          <div>user-area</div>
        </RoleGate>
      </MemoryRouter>
    );
    expect(screen.getByText("user-area")).toBeInTheDocument();
  });

  it("redirects when the role is not allowed", () => {
    mockedUseAuth.mockReturnValue({
      user: { ...user, role: "ANALYST" as Role },
      loading: false,
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
      refresh: vi.fn(),
    });
    render(
      <MemoryRouter>
        <RoleGate roles={["ADMIN"]}>
          <div>admin-area</div>
        </RoleGate>
      </MemoryRouter>
    );
    expect(screen.queryByText("admin-area")).not.toBeInTheDocument();
    expect(screen.getByTestId("navigate-to")).toHaveTextContent("/dashboard");
  });

  it("renders nothing while loading", () => {
    mockedUseAuth.mockReturnValue({
      user: null,
      loading: true,
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
      refresh: vi.fn(),
    });
    render(
      <MemoryRouter>
        <RoleGate roles={["ADMIN"]}>
          <div>admin-area</div>
        </RoleGate>
      </MemoryRouter>
    );
    expect(screen.queryByText("admin-area")).not.toBeInTheDocument();
    expect(screen.queryByTestId("navigate-to")).not.toBeInTheDocument();
  });
});

describe("ConfirmDialog", () => {
  it("calls onConfirm when confirmed", async () => {
    const onConfirm = vi.fn();
    render(<ConfirmDialog open title="Disable account" message="Really disable?" confirmLabel="Disable" danger onConfirm={onConfirm} onCancel={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Disable" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("calls onCancel when cancelled", async () => {
    const onCancel = vi.fn();
    render(<ConfirmDialog open title="Disable account" message="Really disable?" onConfirm={vi.fn()} onCancel={onCancel} />);
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("renders nothing when closed", () => {
    render(<ConfirmDialog open={false} title="T" message="M" onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });
});

// The unused Navigate import reference keeps the mocked module shape valid for TS.
void Navigate;
