import StyleGuidePage from "@/app/style-guide/page";
import { internalPagesHidden } from "./internal-pages";

describe("internalPagesHidden", () => {
  it("hides internal pages on the Vercel production environment, even under next dev", () => {
    expect(internalPagesHidden({ NODE_ENV: "development", VERCEL_ENV: "production" })).toBe(true);
  });

  it("hides them on any production build", () => {
    expect(internalPagesHidden({ NODE_ENV: "production" })).toBe(true);
    expect(internalPagesHidden({ NODE_ENV: "production", VERCEL_ENV: "preview" })).toBe(true);
  });

  it("shows them under next dev", () => {
    expect(internalPagesHidden({ NODE_ENV: "development" })).toBe(false);
    expect(internalPagesHidden({ NODE_ENV: "development", VERCEL_ENV: "development" })).toBe(false);
    expect(internalPagesHidden({ NODE_ENV: "test" })).toBe(false);
  });
});

describe("/style-guide", () => {
  const saved = process.env.VERCEL_ENV;

  afterEach(() => {
    if (saved === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = saved;
  });

  // The page reads the environment when it renders, so calling it is the request.
  it("answers 404 on the Vercel production environment", () => {
    process.env.VERCEL_ENV = "production";
    expect(() => StyleGuidePage()).toThrow("NEXT_NOT_FOUND");
  });

  it("renders the catalogue anywhere else", () => {
    delete process.env.VERCEL_ENV;
    expect(() => StyleGuidePage()).not.toThrow();
  });
});
