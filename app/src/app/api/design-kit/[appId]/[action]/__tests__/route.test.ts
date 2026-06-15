import { beforeEach, describe, expect, it, vi } from "vitest";

// withCustomerAuth is a passthrough so PUT == the inner proxy handler; the test
// invokes PUT(req, authContext, ctx) directly. customerHasAccount/auth-error are
// stubbed so the happy path proceeds and the 403 branch is testable.
vi.mock("@/lib/customer-auth", () => ({
  withCustomerAuth: (handler: any) => handler,
  customerHasAccount: vi.fn(() => true),
  createCustomerAuthError: (msg: string, status: number) =>
    new Response(msg, { status }),
}));

// vi.hoisted so the (hoisted) vi.mock factories can reference these without a TDZ error.
const { getSite, agentFetch } = vi.hoisted(() => ({
  getSite: vi.fn(async () => ({
    agent_url: "https://agent.example",
    id: "app1234567",
  })),
  agentFetch: vi.fn(
    async () => new Response(JSON.stringify({ success: true }), { status: 200 }),
  ),
}));
vi.mock("@/lib/control-plane", () => ({
  getControlPlaneAdapter: () => ({ getSite }),
}));
vi.mock("@/lib/agent-fetch", () => ({ agentFetch }));

vi.mock("@/lib/request-context", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { customerHasAccount } from "@/lib/customer-auth";
import { PUT } from "../route";

function makeRequest(appId: string, action: string, body: unknown): Request {
  return new Request(`https://app/api/design-kit/${appId}/${action}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

const validAuth = { user: {}, jwt: "jwt" };

describe("design-kit BFF proxy", () => {
  beforeEach(() => {
    agentFetch.mockClear();
    getSite.mockClear();
    (customerHasAccount as unknown as ReturnType<typeof vi.fn>).mockClear();
    (customerHasAccount as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      true,
    );
    getSite.mockResolvedValue({ agent_url: "https://agent.example", id: "app1234567" });
    // Fresh Response per call — the proxy consumes the body via response.json(),
    // so a single shared instance would throw "Body has already been read" on the
    // second call (e.g. the allowed-actions loop).
    agentFetch.mockImplementation(
      async () => new Response(JSON.stringify({ success: true }), { status: 200 }),
    );
  });

  it("forwards PUT to the agent design-kit route", async () => {
    const req = makeRequest("app1234567", "colors", {
      palette: { primary: "#000", background: "#fff" },
    });
    const res = await PUT(
      req as never,
      validAuth as never,
      { params: Promise.resolve({ appId: "app1234567", action: "colors" }) } as never,
    );

    expect(res.status).toBe(200);
    expect(agentFetch).toHaveBeenCalledWith(
      "https://agent.example/apps/app1234567/design-kit/colors",
      expect.objectContaining({ siteId: "app1234567", method: "PUT" }),
    );
    await expect(res.json()).resolves.toEqual({ success: true });
  });

  it("forwards the request body verbatim to the agent", async () => {
    const body = { heading: { name: "Oswald" }, body: { name: "Inter" } };
    const req = makeRequest("app1234567", "fonts", body);
    await PUT(
      req as never,
      validAuth as never,
      { params: Promise.resolve({ appId: "app1234567", action: "fonts" }) } as never,
    );

    expect(agentFetch).toHaveBeenCalledWith(
      "https://agent.example/apps/app1234567/design-kit/fonts",
      expect.objectContaining({ body: JSON.stringify(body) }),
    );
  });

  it("forwards each allowed action to the matching agent path", async () => {
    for (const action of [
      "colors",
      "fonts",
      "voice",
      "summary",
      "imagery",
      "wizard-step",
    ]) {
      agentFetch.mockClear();
      const req = makeRequest("app1234567", action, { foo: "bar" });
      const res = await PUT(
        req as never,
        validAuth as never,
        { params: Promise.resolve({ appId: "app1234567", action }) } as never,
      );
      expect(res.status).toBe(200);
      expect(agentFetch).toHaveBeenCalledWith(
        `https://agent.example/apps/app1234567/design-kit/${action}`,
        expect.objectContaining({ siteId: "app1234567", method: "PUT" }),
      );
    }
  });

  it("returns 403 when the customer has no account", async () => {
    (customerHasAccount as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      false,
    );
    const req = makeRequest("app1234567", "colors", { palette: {} });
    const res = await PUT(
      req as never,
      validAuth as never,
      { params: Promise.resolve({ appId: "app1234567", action: "colors" }) } as never,
    );

    expect(res.status).toBe(403);
    expect(agentFetch).not.toHaveBeenCalled();
  });

  it("returns 400 for a disallowed action", async () => {
    const req = makeRequest("app1234567", "evil", { x: 1 });
    const res = await PUT(
      req as never,
      validAuth as never,
      { params: Promise.resolve({ appId: "app1234567", action: "evil" }) } as never,
    );

    expect(res.status).toBe(400);
    expect(agentFetch).not.toHaveBeenCalled();
  });

  it("returns 400 when appId is missing", async () => {
    const req = makeRequest("", "colors", { x: 1 });
    const res = await PUT(
      req as never,
      validAuth as never,
      { params: Promise.resolve({ appId: "", action: "colors" }) } as never,
    );

    expect(res.status).toBe(400);
    expect(agentFetch).not.toHaveBeenCalled();
  });

  it("returns 401 when the auth context has no jwt", async () => {
    const req = makeRequest("app1234567", "colors", { x: 1 });
    const res = await PUT(
      req as never,
      { user: {} } as never,
      { params: Promise.resolve({ appId: "app1234567", action: "colors" }) } as never,
    );

    expect(res.status).toBe(401);
    expect(getSite).not.toHaveBeenCalled();
    expect(agentFetch).not.toHaveBeenCalled();
  });

  it("returns 404 when the site has no agent_url", async () => {
    getSite.mockResolvedValue({ id: "app1234567" } as never);
    const req = makeRequest("app1234567", "colors", { x: 1 });
    const res = await PUT(
      req as never,
      validAuth as never,
      { params: Promise.resolve({ appId: "app1234567", action: "colors" }) } as never,
    );

    expect(res.status).toBe(404);
    expect(agentFetch).not.toHaveBeenCalled();
  });

  it("propagates the agent error status when the agent responds non-ok", async () => {
    agentFetch.mockResolvedValue(
      new Response(JSON.stringify({ error: "boom" }), { status: 502 }),
    );
    const req = makeRequest("app1234567", "colors", { x: 1 });
    const res = await PUT(
      req as never,
      validAuth as never,
      { params: Promise.resolve({ appId: "app1234567", action: "colors" }) } as never,
    );

    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toEqual(
      expect.objectContaining({ status: 502 }),
    );
  });
});
