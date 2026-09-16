import { amzDate, sha256Hex, signV4 } from "./sigv4";

/**
 * The worked example from AWS's Signature Version 4 documentation ("GET an IAM user
 * list"), with its published intermediate hashes. A signer that matches all three is
 * signing the way AWS verifies; one that matches none is wrong in a way no amount of
 * reading would reveal, because a bad signature and bad credentials both come back 403.
 */
describe("signV4", () => {
  const request = {
    method: "GET",
    url: new URL("https://iam.amazonaws.com/?Action=ListUsers&Version=2010-05-08"),
    headers: { "Content-Type": "application/x-www-form-urlencoded; charset=utf-8" },
    payloadHash: sha256Hex(""),
    region: "us-east-1",
    service: "iam",
    accessKeyId: "AKIDEXAMPLE",
    secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
    date: new Date("2015-08-30T12:36:00Z"),
  };

  it("builds the canonical request AWS documents", () => {
    const { canonicalRequest } = signV4(request);
    expect(canonicalRequest).toBe(
      [
        "GET",
        "/",
        "Action=ListUsers&Version=2010-05-08",
        "content-type:application/x-www-form-urlencoded; charset=utf-8",
        "host:iam.amazonaws.com",
        "x-amz-date:20150830T123600Z",
        "",
        "content-type;host;x-amz-date",
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      ].join("\n"),
    );
    expect(sha256Hex(canonicalRequest)).toBe(
      "f536975d06c0309214f805bb90ccff089219ecd68b2577efef23edd43b7e1a59",
    );
  });

  it("produces AWS's published signature and authorization header", () => {
    const { signature, authorization } = signV4(request);
    expect(signature).toBe("5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7");
    expect(authorization).toBe(
      "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/iam/aws4_request, " +
        "SignedHeaders=content-type;host;x-amz-date, " +
        "Signature=5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7",
    );
  });

  it("formats the date the way the x-amz-date header expects", () => {
    expect(amzDate(new Date("2026-01-02T03:04:05.678Z"))).toBe("20260102T030405Z");
  });
});
