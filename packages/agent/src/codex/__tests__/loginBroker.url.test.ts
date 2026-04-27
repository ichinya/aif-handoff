import { describe, expect, it } from "vitest";
import { extractDeviceAuth, maskUserCode } from "../loginBroker.js";

const ANSI = "\x1B[94m";
const RESET = "\x1B[0m";

const FIXTURE_STDOUT = `Welcome to Codex [v${ANSI}0.124.0${RESET}]
${ANSI}OpenAI's command-line coding agent${RESET}

Follow these steps to sign in with ChatGPT using device code authorization:

1. Open this link in your browser and sign in to your account
   ${ANSI}https://auth.openai.com/codex/device${RESET}

2. Enter this one-time code ${ANSI}(expires in 15 minutes)${RESET}
   ${ANSI}5PZO-GPZLR${RESET}

${ANSI}Device codes are a common phishing target. Never share this code.${RESET}
`;

describe("extractDeviceAuth", () => {
  it("parses verification URL and one-time code from real CLI output", () => {
    const result = extractDeviceAuth(FIXTURE_STDOUT);
    expect(result).toEqual({
      verificationUrl: "https://auth.openai.com/codex/device",
      userCode: "5PZO-GPZLR",
    });
  });

  it("strips ANSI escape codes before matching", () => {
    const chunk = `${ANSI}https://auth.openai.com/codex/device${RESET} ${ANSI}ABCD-12345${RESET}`;
    expect(extractDeviceAuth(chunk)).toEqual({
      verificationUrl: "https://auth.openai.com/codex/device",
      userCode: "ABCD-12345",
    });
  });

  it("returns null when only the URL is present (code not yet emitted)", () => {
    const partial = "Open https://auth.openai.com/codex/device and wait...";
    expect(extractDeviceAuth(partial)).toBeNull();
  });

  it("returns null when only the code is present (URL not yet emitted)", () => {
    expect(extractDeviceAuth("ABCD-12345 will appear soon")).toBeNull();
  });

  it("returns null on a malformed lowercase code", () => {
    const chunk = "https://auth.openai.com/codex/device  abcd-12345";
    expect(extractDeviceAuth(chunk)).toBeNull();
  });

  it("returns null when code lacks the dash", () => {
    const chunk = "https://auth.openai.com/codex/device  ABCD12345";
    expect(extractDeviceAuth(chunk)).toBeNull();
  });

  it("returns null on empty input", () => {
    expect(extractDeviceAuth("")).toBeNull();
  });
});

describe("maskUserCode", () => {
  it("masks all but the last 2 characters", () => {
    expect(maskUserCode("5PZO-GPZLR")).toBe("********LR");
  });

  it("returns *** for very short codes", () => {
    expect(maskUserCode("AB")).toBe("***");
    expect(maskUserCode("")).toBe("***");
  });
});
