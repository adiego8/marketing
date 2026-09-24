import { describe, it, expect, afterEach } from "vitest";
import type { DecodedIdToken } from "firebase-admin/auth";
import { isStaff } from "./auth";

// Who counts as numerico's own team, which is now the gate on the install-wide
// OpenAI key. Getting this wrong in either direction is quiet: too narrow and
// the people operating the install cannot configure it, too broad and a
// customer can change the key that bills everyone.

const token = (over: Partial<DecodedIdToken> = {}) =>
  ({ uid: "uid-1", email: "person@numerico.com", ...over }) as DecodedIdToken;

const original = process.env.MARKETING_STAFF_UIDS;
afterEach(() => {
  if (original === undefined) delete process.env.MARKETING_STAFF_UIDS;
  else process.env.MARKETING_STAFF_UIDS = original;
});

describe("isStaff", () => {
  it("lets nobody in when the allowlist is unset", () => {
    // The default, and the one that matters: an install that never set this
    // must not silently hand out staff to the first person who signs in.
    delete process.env.MARKETING_STAFF_UIDS;
    expect(isStaff(token())).toBe(false);
  });

  it("lets nobody in when the allowlist is empty or only separators", () => {
    for (const value of ["", "   ", ",", " , , "]) {
      process.env.MARKETING_STAFF_UIDS = value;
      expect(isStaff(token()), JSON.stringify(value)).toBe(false);
    }
  });

  it("matches a uid", () => {
    process.env.MARKETING_STAFF_UIDS = "uid-1";
    expect(isStaff(token())).toBe(true);
  });

  it("matches an email", () => {
    process.env.MARKETING_STAFF_UIDS = "person@numerico.com";
    expect(isStaff(token({ uid: "someone-else" }))).toBe(true);
  });

  it("ignores case and surrounding space, because this is hand-typed config", () => {
    process.env.MARKETING_STAFF_UIDS = " PERSON@Numerico.com , other ";
    expect(isStaff(token({ uid: "x", email: "person@numerico.com" }))).toBe(true);
    expect(isStaff(token({ uid: "OTHER", email: null as unknown as string }))).toBe(true);
  });

  it("says no to someone not on the list", () => {
    process.env.MARKETING_STAFF_UIDS = "someone@numerico.com";
    expect(isStaff(token())).toBe(false);
  });

  it("survives a token with no email", () => {
    process.env.MARKETING_STAFF_UIDS = "person@numerico.com";
    expect(isStaff(token({ uid: "x", email: undefined }))).toBe(false);
  });

  it("does not depend on the agency, which is the trap", () => {
    // resolveGrant checks staff LAST, so a staff member who is ALSO a paying
    // customer is put in a cust_ agency rather than staff_. Deriving staffness
    // from agencyId would lock out exactly the people most likely to be
    // operating the install. isStaff reads the token and nothing else, and
    // this test exists so it stays that way.
    process.env.MARKETING_STAFF_UIDS = "person@numerico.com";
    expect(isStaff(token())).toBe(true);
  });
});
