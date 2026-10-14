import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import {
  AddCampaignLeadsDto,
  CALL_WINDOW_ORDER_MESSAGE,
  CreateCampaignDto,
  DATE_ORDER_MESSAGE,
  UpdateCampaignDto,
} from "./campaign.dto";

/** Every message the global ValidationPipe would answer with, for one body. */
function errors<T extends object>(type: new () => T, body: Record<string, unknown>): string[] {
  const instance = plainToInstance(type, body);
  return validateSync(instance, { whitelist: true, forbidNonWhitelisted: true }).flatMap(
    (error) => Object.values(error.constraints ?? {}),
  );
}

describe("campaign DTOs", () => {
  describe("timezone", () => {
    it("accepts an IANA zone, and null for the workspace's own", () => {
      expect(errors(CreateCampaignDto, { name: "Outbound", timezone: "Asia/Kolkata" })).toEqual([]);
      expect(errors(UpdateCampaignDto, { timezone: "Europe/London" })).toEqual([]);
      expect(errors(UpdateCampaignDto, { timezone: null })).toEqual([]);
    });

    it("refuses free text", () => {
      for (const timezone of ["Mars/Base", "IST", "+05:30", "india"]) {
        expect(errors(UpdateCampaignDto, { timezone })).toEqual([
          "timezone must be an IANA timezone, such as Asia/Kolkata or Europe/London.",
        ]);
      }
    });
  });

  describe("calling window", () => {
    it("refuses a window that ends when or before it starts", () => {
      expect(
        errors(CreateCampaignDto, { name: "Outbound", callWindowStart: 600, callWindowEnd: 600 }),
      ).toEqual([CALL_WINDOW_ORDER_MESSAGE]);
      expect(errors(UpdateCampaignDto, { callWindowStart: 1140, callWindowEnd: 600 })).toEqual([
        CALL_WINDOW_ORDER_MESSAGE,
      ]);
    });

    it("accepts a window that ends after it starts, and one end alone (the service judges that)", () => {
      expect(errors(UpdateCampaignDto, { callWindowStart: 600, callWindowEnd: 1140 })).toEqual([]);
      expect(errors(UpdateCampaignDto, { callWindowEnd: 1140 })).toEqual([]);
    });
  });

  describe("dates", () => {
    it("refuses an end date that is not after the start date", () => {
      expect(
        errors(CreateCampaignDto, {
          name: "Outbound",
          startDate: "2026-11-02",
          endDate: "2026-11-01",
        }),
      ).toEqual([DATE_ORDER_MESSAGE]);
      expect(
        errors(UpdateCampaignDto, { startDate: "2026-11-02", endDate: "2026-11-02" }),
      ).toEqual([DATE_ORDER_MESSAGE]);
    });

    it("accepts dates in order, and null to clear one", () => {
      expect(
        errors(UpdateCampaignDto, { startDate: "2026-11-01", endDate: "2026-11-30T18:30:00.000Z" }),
      ).toEqual([]);
      expect(errors(UpdateCampaignDto, { startDate: null, endDate: null })).toEqual([]);
    });
  });

  describe("adding leads", () => {
    it("filters by the Leads list's own statuses, not by campaign statuses", () => {
      expect(
        errors(AddCampaignLeadsDto, { allMatchingFilter: true, status: ["NEW", "INTERESTED"] }),
      ).toEqual([]);
      expect(errors(AddCampaignLeadsDto, { allMatchingFilter: true, status: ["ACTIVE"] })).not.toEqual(
        [],
      );
    });

    it("takes the rest of the Leads list's filters", () => {
      expect(
        errors(AddCampaignLeadsDto, {
          allMatchingFilter: true,
          search: "Patna",
          source: ["CSV_IMPORT"],
          city: "Patna",
          scoreBand: "high",
          createdWithinDays: 30,
        }),
      ).toEqual([]);
    });
  });
});
