import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { onAuthStateChanged } from "firebase/auth";
import App from "./App";

vi.mock("./firebase", () => ({
  auth: {
    currentUser: { getIdToken: vi.fn().mockResolvedValue("mock-token") },
  },
  analytics: {},
}));

vi.mock("firebase/auth", () => ({
  onAuthStateChanged: vi.fn(() => () => {}),
  signOut: vi.fn(),
}));

vi.mock("firebase/analytics", () => ({
  logEvent: vi.fn(),
}));

// recharts uses ResizeObserver which is not available in jsdom
vi.mock("recharts", () => ({
  ScatterChart: ({ children }) => <div data-testid="scatter-chart">{children}</div>,
  Scatter: () => null,
  XAxis: () => null,
  YAxis: () => null,
  ReferenceArea: () => null,
  ReferenceLine: () => null,
  Tooltip: () => null,
  ResponsiveContainer: ({ children }) => <div>{children}</div>,
}));

const MOCK_USER = { displayName: "Test User", email: "test@example.com" };

function signInAs(user) {
  onAuthStateChanged.mockImplementation((auth, callback) => {
    callback(user);
    return () => {};
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  onAuthStateChanged.mockImplementation(() => () => {});
});

describe("App auth states", () => {
  it("renders nothing while auth state is loading", () => {
    // onAuthStateChanged never calls back → user stays undefined
    const { container } = render(<App />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders AuthGate when signed out", () => {
    signInAs(null);
    render(<App />);
    expect(screen.getByText(/Đăng nhập với Google/)).toBeInTheDocument();
  });

  it("renders input form when signed in", () => {
    signInAs(MOCK_USER);
    render(<App />);
    expect(screen.getByText("Nên chi tiền vào đâu?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Phân tích ngay/ })).toBeInTheDocument();
  });

  it("shows user display name in sign-out button", () => {
    signInAs(MOCK_USER);
    render(<App />);
    expect(screen.getByText(/Test User/)).toBeInTheDocument();
  });
});

describe("App analyze flow", () => {
  beforeEach(() => {
    signInAs(MOCK_USER);
  });

  it("calls the analyze endpoint on submit", async () => {
    const user = userEvent.setup();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        items: [{ name: "Test Item", emoji: "📦", importance: 8, urgency: 7, reason: "needed" }],
      }),
    });

    render(<App />);
    await user.click(screen.getByRole("button", { name: /Phân tích ngay/ }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledOnce());
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("analyze"),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("shows results view after successful analysis", async () => {
    const user = userEvent.setup();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        items: [{ name: "Test Item", emoji: "📦", importance: 8, urgency: 7, reason: "needed" }],
      }),
    });

    render(<App />);
    await user.click(screen.getByRole("button", { name: /Phân tích ngay/ }));

    await waitFor(() => expect(screen.getByText("Priority Queue")).toBeInTheDocument());
    expect(screen.getByText("Test Item")).toBeInTheDocument();
  });

  it("shows error message on failed analysis", async () => {
    const user = userEvent.setup();
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: "Server exploded" }),
    });

    render(<App />);
    await user.click(screen.getByRole("button", { name: /Phân tích ngay/ }));

    await waitFor(() => expect(screen.getByText(/Có lỗi/)).toBeInTheDocument());
    expect(screen.getByText(/Server exploded/)).toBeInTheDocument();
  });

  it("returns to input form after reset", async () => {
    const user = userEvent.setup();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        items: [{ name: "Test Item", emoji: "📦", importance: 8, urgency: 7, reason: "needed" }],
      }),
    });

    render(<App />);
    await user.click(screen.getByRole("button", { name: /Phân tích ngay/ }));
    await waitFor(() => screen.getByText("Priority Queue"));

    await user.click(screen.getByRole("button", { name: /Phân tích lại/ }));
    expect(screen.getByText("Nên chi tiền vào đâu?")).toBeInTheDocument();
  });
});
