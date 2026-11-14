// Per `architecture/v1-launch-plan.md` Step 2 — Toast renders
// from the global store. Step 5 (reactive layer) will reshape the
// store; these tests pin the contract that any toast in the
// `toasts: { id, msg, until }` slice surfaces on screen.

import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import Toast from "../components/workspace/Toast";
import { useStore } from "../state/store";

beforeEach(() => {
  // Reset toasts and pretend the store had no prior toasts.
  useStore.setState({ toasts: [] });
  cleanup();
});

describe("Toast", () => {
  it("renders nothing when there are no toasts", () => {
    const { container } = render(<Toast />);
    expect(container.querySelector('[data-testid="toast-stack"]')).toBeNull();
  });

  it("renders one toast row per entry in store.toasts", () => {
    useStore.setState({
      toasts: [
        { id: "t1", msg: "Snapshot saved", until: Date.now() + 5000 },
        { id: "t2", msg: "Rules restored", until: Date.now() + 5000 },
      ],
    });
    render(<Toast />);
    const toasts = screen.getAllByTestId("toast");
    expect(toasts).toHaveLength(2);
  });

  it("messages containing 'failed' get the error border class", () => {
    useStore.setState({
      toasts: [{ id: "t1", msg: "Plan failed to apply", until: Date.now() + 5000 }],
    });
    render(<Toast />);
    const toast = screen.getByTestId("toast");
    expect(toast.className).toMatch(/violation/);
  });

  it("messages containing 'saved' get the success border class", () => {
    useStore.setState({
      toasts: [{ id: "t1", msg: "Layout saved", until: Date.now() + 5000 }],
    });
    render(<Toast />);
    const toast = screen.getByTestId("toast");
    expect(toast.className).toMatch(/phase-pass/);
  });

  it("neutral messages get the plain outline border class", () => {
    useStore.setState({
      toasts: [{ id: "t1", msg: "Heads up", until: Date.now() + 5000 }],
    });
    render(<Toast />);
    const toast = screen.getByTestId("toast");
    expect(toast.className).toMatch(/border-outline/);
  });

  it("toasts have an aria-live polite role for screen readers", () => {
    useStore.setState({
      toasts: [{ id: "t1", msg: "hello", until: Date.now() + 5000 }],
    });
    render(<Toast />);
    const stack = screen.getByTestId("toast-stack");
    expect(stack.getAttribute("aria-live")).toBe("polite");
  });
});
