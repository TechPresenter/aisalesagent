import { ForbiddenException, HttpStatus, NotImplementedException } from "@nestjs/common";
import { isLogOnly } from "../common/all-exceptions.filter";
import { RecordingsController } from "./recordings.controller";
import type { RecordingsService } from "./recordings.service";

/**
 * The audio route is public — the signature is its credential — and has no audio to
 * serve yet. What matters is the status code: a 200 carrying `{ statusCode: 501 }` is
 * what a player or a download would take for the recording itself.
 */

const RECORDING_ID = "6f0c1f8e-2b7a-4c1e-9d55-0d1b8f3a9c21";

function controller(valid: boolean) {
  const verifySignature = jest.fn().mockReturnValue(valid);
  const recordings = { verifySignature } as unknown as RecordingsService;
  return { controller: new RecordingsController(recordings), verifySignature };
}

function thrownBy(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error("expected the route to throw");
}

describe("RecordingsController.audio", () => {
  it("answers a valid link with HTTP 501, not a 200 that says 501", () => {
    const { controller: recordings, verifySignature } = controller(true);
    const error = thrownBy(() => recordings.audio(RECORDING_ID, "1900000000", "sig"));

    expect(error).toBeInstanceOf(NotImplementedException);
    expect((error as NotImplementedException).getStatus()).toBe(HttpStatus.NOT_IMPLEMENTED);
    expect(verifySignature).toHaveBeenCalledWith(RECORDING_ID, 1900000000, "sig");
    // A known gap, not a fault: logged, but not sent to Sentry.
    expect(isLogOnly(error)).toBe(true);
  });

  it("refuses an invalid or expired link with 403 before anything else", () => {
    const { controller: recordings } = controller(false);
    const error = thrownBy(() => recordings.audio(RECORDING_ID, "1900000000", "forged"));

    expect(error).toBeInstanceOf(ForbiddenException);
  });

  it("treats a missing signature as an empty one rather than crashing", () => {
    const { controller: recordings, verifySignature } = controller(false);
    thrownBy(() =>
      recordings.audio(RECORDING_ID, "1900000000", undefined as unknown as string),
    );

    expect(verifySignature).toHaveBeenCalledWith(RECORDING_ID, 1900000000, "");
  });
});
