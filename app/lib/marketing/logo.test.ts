import { describe, it, expect } from "vitest";
import {
  ALLOWED_LOGO_LABEL,
  MAX_LOGO_BYTES,
  clientPrefix,
  downloadUrlFor,
  extensionFor,
  objectPathFromUrl,
  sniffImageType,
  storagePathFor,
  type LogoType,
} from "./logo";

/**
 * Two of these functions are the only thing standing between an upload form and
 * a stored-XSS, and neither failure is visible in a click-through.
 *
 * sniffImageType is what stops an HTML file wearing a .png extension landing on
 * a googleapis.com URL. objectPathFromUrl is what stops a value read back out
 * of the database making us delete somebody else's object.
 */

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
const WEBP = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, // RIFF
  0x24, 0x00, 0x00, 0x00, // size, skipped
  0x57, 0x45, 0x42, 0x50, // WEBP
]);

function ascii(text: string): Uint8Array {
  return new Uint8Array([...text].map((c) => c.charCodeAt(0)));
}

describe("sniffImageType", () => {
  it("recognises the four formats we accept", () => {
    expect(sniffImageType(PNG)).toBe("image/png");
    expect(sniffImageType(JPEG)).toBe("image/jpeg");
    expect(sniffImageType(GIF)).toBe("image/gif");
    expect(sniffImageType(WEBP)).toBe("image/webp");
  });

  /**
   * The attack. A browser's declared content-type is trivially "image/png" on
   * anything at all, and the stored object becomes fetchable from a
   * trusted-looking host — so the bytes have to decide, not the label.
   */
  it("refuses HTML pretending to be an image", () => {
    expect(sniffImageType(ascii("<html><script>alert(1)</script>"))).toBeNull();
    expect(sniffImageType(ascii("<!DOCTYPE html>"))).toBeNull();
  });

  // A real image format, refused on purpose: it can carry script, and a brand
  // mark gets embedded where we do not control the context.
  it("refuses SVG", () => {
    expect(sniffImageType(ascii('<svg xmlns="http://www.w3.org/2000/svg">'))).toBeNull();
    expect(sniffImageType(ascii('<?xml version="1.0"?><svg>'))).toBeNull();
  });

  it("refuses other things that are genuinely files", () => {
    expect(sniffImageType(ascii("%PDF-1.7"))).toBeNull();
    expect(sniffImageType(new Uint8Array([0x50, 0x4b, 0x03, 0x04]))).toBeNull(); // zip
  });

  // A truncated upload must not match on a partial signature.
  it("refuses bytes too short to identify", () => {
    expect(sniffImageType(new Uint8Array([]))).toBeNull();
    expect(sniffImageType(new Uint8Array([0x89, 0x50]))).toBeNull();
    expect(sniffImageType(new Uint8Array([0xff, 0xd8]))).toBeNull();
  });

  // RIFF alone is not WebP — it is also WAV and AVI, which must not pass.
  it("does not mistake other RIFF containers for WebP", () => {
    const wav = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45,
    ]);
    expect(sniffImageType(wav)).toBeNull();
  });
});

describe("extensionFor", () => {
  it("covers every type sniffImageType can return", () => {
    const types: LogoType[] = ["image/png", "image/jpeg", "image/gif", "image/webp"];
    for (const type of types) {
      expect(extensionFor(type), type).toBeTruthy();
    }
    expect(extensionFor("image/jpeg")).toBe("jpg");
  });
});

describe("storagePathFor", () => {
  it("puts the object inside the client's own prefix", () => {
    expect(storagePathFor("c1", "png").startsWith(clientPrefix("c1"))).toBe(true);
  });

  /**
   * A reused path plus immutable caching leaves every proxy serving the old
   * logo forever. A new name each time is what makes the swap visible.
   */
  it("never reuses a name", () => {
    const paths = new Set(Array.from({ length: 200 }, () => storagePathFor("c1", "png")));
    expect(paths.size).toBe(200);
  });

  it("keeps the extension the sniffed type chose", () => {
    expect(storagePathFor("c1", "webp").endsWith(".webp")).toBe(true);
  });

  it("keeps two clients apart", () => {
    expect(storagePathFor("c1", "png").startsWith(clientPrefix("c2"))).toBe(false);
  });
});

describe("objectPathFromUrl", () => {
  const path = "marketing/clients/c1/abc-123.png";
  const url = downloadUrlFor("bucket.appspot.com", path, "token-uuid");

  it("round-trips a URL it built itself", () => {
    expect(objectPathFromUrl(url, "c1")).toBe(path);
  });

  /**
   * The guard that matters. logo_url has held arbitrary operator-typed strings
   * historically, so a value read back out of Firestore must never be able to
   * aim a delete at another client's object.
   */
  it("refuses another client's object", () => {
    expect(objectPathFromUrl(url, "c2")).toBeNull();
  });

  it("refuses a traversal out of the prefix", () => {
    const evil = downloadUrlFor("b", "marketing/clients/c1/../c2/logo.png", "t");
    expect(objectPathFromUrl(evil, "c1")).toBeNull();
  });

  it("refuses a host that is not Firebase Storage", () => {
    expect(
      objectPathFromUrl("https://evil.example/v0/b/x/o/marketing%2Fclients%2Fc1%2Fa.png", "c1")
    ).toBeNull();
  });

  it("refuses a non-https scheme", () => {
    expect(
      objectPathFromUrl(
        "http://firebasestorage.googleapis.com/v0/b/x/o/marketing%2Fclients%2Fc1%2Fa.png",
        "c1"
      )
    ).toBeNull();
  });

  // Every logo stored before this feature existed is some other host entirely.
  // Those must simply not be deletable, rather than throw.
  it("refuses a pasted URL from the old text field", () => {
    expect(objectPathFromUrl("https://example.com/logo.png", "c1")).toBeNull();
    expect(objectPathFromUrl("https://cdn.acme.io/brand/logo.svg", "c1")).toBeNull();
  });

  it("returns null for junk rather than throwing", () => {
    expect(objectPathFromUrl(null, "c1")).toBeNull();
    expect(objectPathFromUrl(undefined, "c1")).toBeNull();
    expect(objectPathFromUrl("", "c1")).toBeNull();
    expect(objectPathFromUrl("not a url", "c1")).toBeNull();
    expect(objectPathFromUrl("https://firebasestorage.googleapis.com/", "c1")).toBeNull();
  });
});

describe("downloadUrlFor", () => {
  it("encodes the path so slashes survive the round trip", () => {
    const url = downloadUrlFor("b.appspot.com", "marketing/clients/c1/a.png", "tok");
    expect(url).toContain("marketing%2Fclients%2Fc1%2Fa.png");
    expect(url).toContain("alt=media");
    expect(url).toContain("token=tok");
  });

  it("points at the Firebase Storage service, not the raw GCS host", () => {
    // storage.googleapis.com would need a public ACL, which uniform
    // bucket-level access refuses. This host does not.
    expect(downloadUrlFor("b", "p", "t")).toContain("firebasestorage.googleapis.com");
  });
});

describe("the limits", () => {
  it("caps a logo at 1 MB", () => {
    expect(MAX_LOGO_BYTES).toBe(1024 * 1024);
  });

  // The UI and the API must say the same thing, or an operator is told one set
  // of formats and refused on another.
  it("names the formats it actually accepts", () => {
    expect(ALLOWED_LOGO_LABEL).toBe("PNG, JPEG, GIF or WebP");
    expect(ALLOWED_LOGO_LABEL).not.toMatch(/svg/i);
  });
});
