import { describe, it, expect, afterEach } from "vitest";
import type { DecodedIdToken } from "firebase-admin/auth";
import { isStaff, isAgencyOwner, sessionPayload } from "./auth";

// Two access rules, both quiet when wrong.
//
// isStaff decides who can sign in at all off the entitlement rail. isAgencyOwner
// decides who can change the install-wide OpenAI key — too narrow and the person
// running the install cannot configure it, too broad and a customer changes the
// key that bills everyone.

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

describe("isAgencyOwner", () => {
  const UID = "DrADef";

  it("matches the recorded owner", () => {
    expect(isAgencyOwner({ ownerUid: UID }, UID)).toBe(true);
  });

  it("says no to anyone else in the agency", () => {
    // Including an admin. resolveGrant hands admin to every paying customer,
    // so role is not this question and must not accidentally become it.
    expect(isAgencyOwner({ ownerUid: UID, role: "admin" }, "someone-else")).toBe(false);
  });

  it("says no when the agency has no owner recorded", () => {
    // Possible on an agency a teammate created before the owner first signed
    // in. Refusing is right: ensureMember backfills ownerUid on the owner's
    // next sign-in, and requireOwner's message says so.
    expect(isAgencyOwner({}, UID)).toBe(false);
    expect(isAgencyOwner({ ownerUid: null }, UID)).toBe(false);
    expect(isAgencyOwner({ ownerUid: "" }, UID)).toBe(false);
    expect(isAgencyOwner(undefined, UID)).toBe(false);
  });

  it("never matches two missing values against each other", () => {
    // The lockout case inverted, and the dangerous one: a blank ownerUid and a
    // blank uid comparing equal would hand the key to whoever asked first.
    expect(isAgencyOwner({ ownerUid: "" }, "")).toBe(false);
    expect(isAgencyOwner({}, "")).toBe(false);
  });

  it("does not coerce a non-string ownerUid into a match", () => {
    expect(isAgencyOwner({ ownerUid: 0 }, UID)).toBe(false);
    expect(isAgencyOwner({ ownerUid: true }, UID)).toBe(false);
    expect(isAgencyOwner({ ownerUid: [UID] }, UID)).toBe(false);
  });

  it("is exact, not a prefix or case-insensitive match", () => {
    // Unlike isStaff, which reads hand-typed config. A uid is machine-issued
    // and compared verbatim; loosening it here would only widen the gate.
    expect(isAgencyOwner({ ownerUid: UID }, UID.toLowerCase())).toBe(false);
    expect(isAgencyOwner({ ownerUid: UID }, UID.slice(0, 3))).toBe(false);
    expect(isAgencyOwner({ ownerUid: UID.slice(0, 3) }, UID)).toBe(false);
  });
});

describe("sessionPayload", () => {
  const session = {
    uid: "DrADef",
    email: "team.leader@numerico.co",
    agencyId: "cust_1",
    role: "admin",
  };

  it("reports the owner as the owner", () => {
    expect(sessionPayload(session, { ownerUid: "DrADef" })).toEqual({
      user_email: "team.leader@numerico.co",
      agency_id: "cust_1",
      role: "admin",
      owner: true,
    });
  });

  it("does not make an admin an owner", () => {
    expect(sessionPayload(session, { ownerUid: "someone-else" }).owner).toBe(false);
  });

  it("always carries owner, which is the bug this function exists to prevent", () => {
    // /auth/me and /auth/session both answer "who am I" and both feed the same
    // AuthProvider. They were two hand-written literals and drifted within a
    // day: `owner` went into one and not the other, so it arrived undefined on
    // the route the app actually calls, `data.owner === true` was false for
    // everyone, and the settings card rendered for nobody — including the
    // owner. Undefined is the shape of that failure, so assert against it.
    for (const agency of [{ ownerUid: "DrADef" }, { ownerUid: "x" }, {}, undefined]) {
      expect(sessionPayload(session, agency)).toHaveProperty("owner");
      expect(typeof sessionPayload(session, agency).owner).toBe("boolean");
    }
  });

  it("gives an empty string rather than null for a missing email", () => {
    expect(sessionPayload({ ...session, email: null }, {}).user_email).toBe("");
  });
});
