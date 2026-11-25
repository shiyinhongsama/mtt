import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, api, getToken, setToken } from "./client";

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe("api", () => {
  it("classifies network failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));

    const error = await api("/reviews/due").catch((value: unknown) => value);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ kind: "network", status: null });
  });

  it("classifies response errors and preserves server detail", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ detail: "question is outside the plan bank" }),
      { status: 409, headers: { "Content-Type": "application/json" } },
    )));

    const error = await api("/reviews", { method: "POST", body: {} }).catch((value: unknown) => value);

    expect(error).toMatchObject({
      kind: "conflict",
      status: 409,
      message: "question is outside the plan bank",
    });
  });

  it("notifies the app before throwing an authentication error", async () => {
    setToken("expired");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 401 })));
    const reauth = vi.fn();
    window.addEventListener("mtt:reauth", reauth, { once: true });

    const error = await api("/reviews").catch((value: unknown) => value);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ kind: "auth", status: 401 });
    expect(reauth).toHaveBeenCalledOnce();
    expect(getToken()).toBe("");
  });
});
