import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const connectDBMock = vi.fn(async () => undefined);

const memoryLeanMock = vi.fn();
const memoryLimitMock = vi.fn(() => ({ lean: memoryLeanMock }));
const memorySortMock = vi.fn(() => ({ limit: memoryLimitMock }));
const memoryFindMock = vi.fn(() => ({ sort: memorySortMock }));

vi.mock("@/lib/mongodb", () => ({
  connectDB: connectDBMock,
}));

vi.mock("@/lib/models/Memory", () => ({
  default: {
    find: memoryFindMock,
  },
}));

function buildGetRequest(query = ""): NextRequest {
  const suffix = query ? `?${query}` : "";
  return new NextRequest(`http://localhost:3000/api/memory${suffix}`, {
    method: "GET",
  });
}

describe("GET /api/memory", () => {
  beforeEach(() => {
    vi.resetModules();
    connectDBMock.mockClear();
    memoryFindMock.mockClear();
    memorySortMock.mockClear();
    memoryLimitMock.mockClear();
    memoryLeanMock.mockClear();
  });

  it("returns 403 in production", async () => {
    const env = process.env as Record<string, string | undefined>;
    env.NODE_ENV = "production";
    const route = await import("@/app/api/memory/route");

    const response = await route.GET(buildGetRequest("userId=u-1"));
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(403);
    expect(body.error).toMatch(/disabled in production/i);
    expect(connectDBMock).not.toHaveBeenCalled();
  });

  it("returns normalized memory facts in development", async () => {
    const env = process.env as Record<string, string | undefined>;
    env.NODE_ENV = "development";
    memoryLeanMock.mockResolvedValueOnce([
      {
        key: "preference:likes:chess",
        value: "chess",
        importance: 4,
        source: "preference",
        lastAccessed: "2026-03-22T12:00:00.000Z",
      },
    ]);

    const route = await import("@/app/api/memory/route");
    const response = await route.GET(buildGetRequest("userId=u-1&limit=30"));
    const body = (await response.json()) as {
      userId: string;
      count: number;
      memories: Array<{
        key: string;
        value: string;
        importance: number;
        source: string;
      }>;
    };

    expect(response.status).toBe(200);
    expect(connectDBMock).toHaveBeenCalledTimes(1);
    expect(memoryFindMock).toHaveBeenCalledWith({ userId: "u-1", deletedAt: null });
    expect(body.userId).toBe("u-1");
    expect(body.count).toBe(1);
    expect(body.memories[0]).toMatchObject({
      key: "preference:likes:chess",
      value: "chess",
      importance: 4,
      source: "preference",
    });
  });
});
