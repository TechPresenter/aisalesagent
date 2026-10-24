import {
  ApiError,
  isApiReachable,
  leadsApi,
  type ApiLead,
  type PaginatedLeads,
} from "./api-client";
import {
  TooManyLeadsError,
  addLeadsToCampaign,
  collectLeadIds,
  fetchLeads,
} from "./leads-repository";

/**
 * The Leads page used to answer a failed request with sixty invented leads. These pin
 * what it does now: an error reaches the screen, and seed rows appear only in local
 * development with no API at all — never in a production build.
 */

jest.mock("./api-client", () => {
  const actual = jest.requireActual("./api-client");
  return {
    ...actual,
    isApiReachable: jest.fn(),
    leadsApi: { ...actual.leadsApi, list: jest.fn() },
  };
});

const reachable = isApiReachable as jest.MockedFunction<typeof isApiReachable>;
const list = leadsApi.list as jest.MockedFunction<typeof leadsApi.list>;
const env = process.env as Record<string, string | undefined>;
const originalNodeEnv = env.NODE_ENV;

function lead(id: string): ApiLead {
  return {
    id,
    tenantId: "t1",
    name: `Lead ${id}`,
    contactPerson: null,
    jobTitle: null,
    phone: "919876543210",
    email: null,
    website: null,
    address: null,
    city: "Pune",
    state: null,
    country: "India",
    industry: null,
    companySize: null,
    source: "MANUAL",
    status: "NEW",
    score: 0,
    scoreReasons: null,
    temperature: "COLD",
    ownerId: null,
    customFields: null,
    doNotCall: false,
    lastContactedAt: null,
    convertedAt: null,
    createdAt: "2026-10-14T00:00:00.000Z",
    updatedAt: "2026-10-14T00:00:00.000Z",
  };
}

/** A paged answer over `ids`, as `GET /leads` gives it. */
function pageOf(ids: string[], page: number, pageSize: number): PaginatedLeads {
  return {
    data: ids.slice((page - 1) * pageSize, page * pageSize).map(lead),
    page,
    pageSize,
    total: ids.length,
    totalPages: Math.max(1, Math.ceil(ids.length / pageSize)),
  };
}

afterEach(() => {
  env.NODE_ENV = originalNodeEnv;
  jest.clearAllMocks();
});

describe("fetchLeads", () => {
  it("passes an API error through instead of showing seed rows", async () => {
    reachable.mockResolvedValue(true);
    list.mockRejectedValue(new ApiError("Internal server error", 500));

    await expect(fetchLeads({ page: 1 })).rejects.toThrow("Internal server error");
  });

  it("never shows seed rows in production, even with the API unreachable", async () => {
    env.NODE_ENV = "production";
    reachable.mockResolvedValue(false);
    list.mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(fetchLeads()).rejects.toThrow("Failed to fetch");
    // Production does not even ask: a cached "unreachable" must not outlive a retry.
    expect(reachable).not.toHaveBeenCalled();
  });

  it("falls back to seed rows in development when no API is running", async () => {
    env.NODE_ENV = "development";
    reachable.mockResolvedValue(false);
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);

    const page = await fetchLeads({ pageSize: 5 });
    expect(page.source).toBe("seed");
    expect(page.leads).toHaveLength(5);
    expect(list).not.toHaveBeenCalled();
    // The fallback announces itself rather than passing seed rows off quietly.
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("reads the API and carries the do-not-call flag", async () => {
    reachable.mockResolvedValue(true);
    list.mockResolvedValue({ ...pageOf(["a"], 1, 10), data: [{ ...lead("a"), doNotCall: true }] });

    const page = await fetchLeads();
    expect(page.source).toBe("api");
    expect(page.leads[0].doNotCall).toBe(true);
  });
});

describe("collectLeadIds", () => {
  it("walks every page of the filter at the API's largest page size", async () => {
    const ids = Array.from({ length: 450 }, (_, i) => `lead-${i}`);
    list.mockImplementation(async (query = {}) =>
      pageOf(ids, query.page ?? 1, query.pageSize ?? 10),
    );

    const collected = await collectLeadIds({ status: ["NEW"], city: "Pune" }, 10_000);

    expect(collected).toEqual(ids);
    expect(list).toHaveBeenCalledTimes(3);
    expect(list.mock.calls[0][0]).toEqual({
      status: ["NEW"],
      city: "Pune",
      page: 1,
      pageSize: 200,
    });
  });

  it("refuses a filter that matches more than the limit", async () => {
    list.mockResolvedValue(
      pageOf(
        Array.from({ length: 12 }, (_, i) => `x${i}`),
        1,
        200,
      ),
    );

    await expect(collectLeadIds({}, 10)).rejects.toBeInstanceOf(TooManyLeadsError);
  });
});

describe("addLeadsToCampaign", () => {
  it("sends at most 1,000 ids per request and adds the answers up", async () => {
    const add = jest.fn(async (_id: string, leadIds: string[]) => ({
      added: leadIds.length - 1,
      skipped: 1,
    }));
    const ids = Array.from({ length: 2_500 }, (_, i) => `lead-${i}`);

    const result = await addLeadsToCampaign("campaign-1", ids, add);

    expect(add.mock.calls.map(([, chunk]) => chunk.length)).toEqual([1_000, 1_000, 500]);
    expect(result).toEqual({ added: 2_497, skipped: 3 });
  });
});
