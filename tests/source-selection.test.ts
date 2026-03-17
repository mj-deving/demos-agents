import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SourceRecordV2 } from "../tools/lib/sources/catalog.js";

const { getProviderAdapterMock } = vi.hoisted(() => ({
  getProviderAdapterMock: vi.fn(),
}));

vi.mock("../tools/lib/sources/providers/index.js", () => ({
  getProviderAdapter: getProviderAdapterMock,
}));

import { selectSourceForTopicV2 } from "../tools/lib/sources/policy.js";
import { buildSourceIndex } from "../tools/lib/sources/catalog.js";

function makeSource(overrides: Partial<SourceRecordV2> = {}): SourceRecordV2 {
  return {
    id: "src-default",
    name: "test-source",
    provider: "test",
    url: "https://example.com/api",
    urlPattern: "",
    topics: ["crypto"],
    topicAliases: [],
    domainTags: [],
    responseFormat: "json",
    scope: { visibility: "public" as const },
    runtime: "static" as const,
    trustTier: "verified" as const,
    status: "active" as const,
    rating: { overall: 80, history: [] },
    lifecycle: { consecutivePasses: 3, consecutiveFails: 0, lastTested: "" },
    tlsn_safe: true,
    dahr_safe: true,
    max_response_kb: 5,
    note: "",
    adapter: "test",
    ...overrides,
  };
}

function makeView(sources: SourceRecordV2[]) {
  return {
    agent: "sentinel" as const,
    catalogVersion: 2 as const,
    sources,
    index: buildSourceIndex(sources),
  };
}

// Stub adapter that always returns a valid candidate
const fakeAdapter = {
  supports: () => true,
  buildCandidates: (req: any) => [{ url: req.source.url, source: req.source, topic: req.topic, attestation: req.attestation }],
  validateCandidate: (c: any) => ({ ok: true, rewrittenUrl: c.url }),
};

describe("selectSourceForTopicV2", () => {
  beforeEach(() => {
    getProviderAdapterMock.mockReturnValue(fakeAdapter);
  });

  it("prefers larger response sources for DAHR when scores tie", () => {
    const thin = makeSource({
      id: "thin-1kb",
      name: "blockstream-block-tip",
      topics: ["crypto", "bitcoin"],
      max_response_kb: 1,
    });
    const rich = makeSource({
      id: "rich-2kb",
      name: "blockchain-info-ticker",
      topics: ["crypto", "bitcoin"],
      max_response_kb: 2,
    });

    const view = makeView([thin, rich]);
    const result = selectSourceForTopicV2("bitcoin", view, "DAHR");

    expect(result).not.toBeNull();
    expect(result!.source.id).toBe("rich-2kb");
  });

  it("prefers smaller response sources for TLSN when scores tie", () => {
    const thin = makeSource({
      id: "thin-1kb",
      name: "blockstream-block-tip",
      topics: ["crypto", "bitcoin"],
      max_response_kb: 1,
    });
    const rich = makeSource({
      id: "rich-2kb",
      name: "blockchain-info-ticker",
      topics: ["crypto", "bitcoin"],
      max_response_kb: 2,
    });

    const view = makeView([thin, rich]);
    const result = selectSourceForTopicV2("bitcoin", view, "TLSN");

    expect(result).not.toBeNull();
    expect(result!.source.id).toBe("thin-1kb");
  });

  it("DAHR tiebreak prefers larger response (richer evidence) without changing scores", () => {
    const tiny = makeSource({
      id: "tiny",
      name: "tiny-source",
      topics: ["crypto", "bitcoin"],
      max_response_kb: 1,
    });
    const medium = makeSource({
      id: "medium",
      name: "medium-source",
      topics: ["crypto", "bitcoin"],
      max_response_kb: 10,
    });

    const view = makeView([tiny, medium]);
    const result = selectSourceForTopicV2("bitcoin", view, "DAHR");

    // Same base score, DAHR tiebreak prefers larger
    expect(result).not.toBeNull();
    expect(result!.source.id).toBe("medium");
  });

  it("TLSN gives small response bonus that DAHR does not", () => {
    const small = makeSource({
      id: "small",
      name: "small-source",
      topics: ["crypto", "bitcoin"],
      max_response_kb: 5,
      tlsn_safe: true,
    });
    const large = makeSource({
      id: "large",
      name: "large-source",
      topics: ["crypto", "bitcoin"],
      max_response_kb: 50,
      tlsn_safe: true,
    });

    const viewTlsn = makeView([small, large]);
    const resultTlsn = selectSourceForTopicV2("bitcoin", viewTlsn, "TLSN");
    // TLSN: small gets +1 bonus → wins on score
    expect(resultTlsn!.source.id).toBe("small");

    const viewDahr = makeView([small, large]);
    const resultDahr = selectSourceForTopicV2("bitcoin", viewDahr, "DAHR");
    // DAHR: no bonus, tiebreak prefers larger
    expect(resultDahr!.source.id).toBe("large");
  });
});
