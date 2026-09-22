import { describe, it, expect } from "vitest";
import { humanizeWarnings } from "./humanize";
import { languageFor } from "./brand";
import type { SlotCopy } from "./copy";

// The property that matters most here is SILENCE. This banner already carries
// platform limits, language, CTA, caption echo and missing production notes; a
// check that fires on ordinary writing would make it a wall nobody reads, and
// would cost more than it caught. Most of these tests are about not warning.

const EN = languageFor("en");
const ES = languageFor("es");
const NL = languageFor("nl");

function copyOf(partial: Partial<SlotCopy>): SlotCopy {
  return {
    headline: null,
    blocks: [],
    caption: null,
    hashtags: [],
    sourceHash: "",
    generatedAt: "",
    model: null,
    editedAt: null,
    ...partial,
  };
}

/** One block of published words, which is the shape every check reads. */
function post(text: string): SlotCopy {
  return copyOf({ blocks: [{ label: "Post", text }] });
}

const opts = (language = EN, wordsToAvoid: string[] = []) => ({
  language,
  wordsToAvoid,
});

const CLEAN_EN =
  "Everyone celebrates the refund and almost nobody prices it. If you got four " +
  "thousand back this year, you spent twelve months as an interest-free lender. " +
  "One W-4 change puts that money into your monthly cash flow instead.";

const CLEAN_ES =
  "Todo el mundo celebra la devolución de impuestos y casi nadie le pone precio. " +
  "Si este año te devolvieron cuatro mil euros, pasaste doce meses prestando " +
  "dinero sin intereses. Un solo formulario lo cambia.";

describe("humanizeWarnings — silence on writing that is fine", () => {
  it("says nothing about clean English", () => {
    expect(humanizeWarnings(post(CLEAN_EN), opts())).toEqual([]);
  });

  it("says nothing about clean Spanish", () => {
    expect(humanizeWarnings(post(CLEAN_ES), opts(ES))).toEqual([]);
  });

  it("says nothing about absent copy", () => {
    expect(humanizeWarnings(null, opts())).toEqual([]);
    expect(humanizeWarnings(copyOf({}), opts())).toEqual([]);
  });

  it("leaves a single marker alone", () => {
    // The skill's central claim: AI vocabulary appears in 10% of human
    // captions, so one is not a verdict. A checker firing on one would be
    // wrong nine times out of ten.
    expect(
      humanizeWarnings(post("We built a robust way to quote a job in four hours."), opts())
    ).toEqual([]);
  });

  it("leaves two markers alone", () => {
    expect(
      humanizeWarnings(
        post("A robust, comprehensive way to quote a job before you leave the driveway."),
        opts()
      )
    ).toEqual([]);
  });

  it("does not mistake an ordinary result for a reveal bridge", () => {
    // "The result?" withholds. "The result was a 40% lift" is a sentence. The
    // punctuation is the entire difference.
    expect(
      humanizeWarnings(post("We changed one form. The result was a 40% lift in cash flow."), opts())
    ).toEqual([]);
  });

  it("leaves one natural triad and two fragments alone", () => {
    expect(
      humanizeWarnings(
        post("Faster quotes, fewer callbacks and a crew that knows the day's plan. Every time."),
        opts()
      )
    ).toEqual([]);
  });
});

describe("humanizeWarnings — vocabulary", () => {
  it("warns at three markers in one block", () => {
    const out = humanizeWarnings(
      post("Our comprehensive insights foster a robust way of working."),
      opts()
    );
    expect(out.join(" ")).toContain("reads like a machine wrote it");
    expect(out.join(" ")).toContain("comprehensive");
  });

  it("counts density per block, not across the piece", () => {
    // Two blocks of two markers each is four in the piece and three in neither.
    const out = humanizeWarnings(
      copyOf({
        blocks: [
          { label: "Slide 1", text: "A robust and comprehensive way to quote." },
          { label: "Slide 2", text: "Nuanced insights about what a job costs." },
        ],
      }),
      opts()
    );
    expect(out).toEqual([]);
  });

  it("catches a reveal bridge on a single hit", () => {
    const out = humanizeWarnings(post("We changed one form. The result? Six hours back."), opts());
    expect(out.join(" ")).toContain("reveal bridge");
  });

  it("catches performed sincerity on a single hit", () => {
    const out = humanizeWarnings(
      post("Real talk, this one hurt: we lost our biggest client in February."),
      opts()
    );
    expect(out.join(" ")).toContain("performed sincerity");
  });

  it("catches negative parallelism, which is a shape rather than a phrase", () => {
    const out = humanizeWarnings(post("No forms. No waiting. Just the number."), opts());
    expect(out.join(" ")).toContain("negative parallelism");
  });

  it("catches a dead closer", () => {
    const out = humanizeWarnings(post(`${CLEAN_EN} What do you think?`), opts());
    expect(out.join(" ")).toContain("dead closer");
  });
});

describe("humanizeWarnings — language", () => {
  it("uses the Spanish vocabulary for a Spanish client", () => {
    const out = humanizeWarnings(
      post("Una solución integral y robusta para potenciar tu negocio."),
      opts(ES)
    );
    expect(out.join(" ")).toContain("reads like a machine wrote it");
  });

  it("does not apply English vocabulary to Spanish copy", () => {
    // "integral" and "clave" are ordinary Spanish; "insights" is not Spanish at
    // all. Running the wrong list would warn about the wrong things.
    expect(humanizeWarnings(post(CLEAN_ES), opts(ES))).toEqual([]);
  });

  it("says nothing about vocabulary in a language it has no list for", () => {
    // Dutch gets structure only. Guessing at a vocabulary nobody measured would
    // be worse than silence — the same bargain as hashtags in language.ts.
    const dutch = post(
      "Iedereen viert de teruggave en bijna niemand rekent uit wat die kost aan rente."
    );
    expect(humanizeWarnings(dutch, opts(NL))).toEqual([]);
  });

  it("still applies structure in a language it has no vocabulary for", () => {
    const out = humanizeWarnings(post("Kort. Krachtig. Klaar. Altijd."), opts(NL));
    expect(out.join(" ")).toContain("fragments");
  });
});

describe("humanizeWarnings — structure", () => {
  it("warns above about one em dash per hundred words", () => {
    const out = humanizeWarnings(
      post("A refund — your own money — handed back late — twelve months late."),
      opts()
    );
    expect(out.join(" ")).toContain("em dashes");
  });

  it("allows one em dash in a short piece", () => {
    expect(
      humanizeWarnings(post("A refund is not a bonus — it is your own paycheck, late."), opts())
    ).toEqual([]);
  });

  it("warns at four emoji and allows three", () => {
    expect(humanizeWarnings(post(`${CLEAN_EN} 🎯🔥💡`), opts())).toEqual([]);
    expect(humanizeWarnings(post(`${CLEAN_EN} 🎯🔥💡📈`), opts()).join(" ")).toContain("emoji");
  });

  it("warns at three fragments and allows two", () => {
    expect(humanizeWarnings(post(`${CLEAN_EN} Every time. Still.`), opts())).toEqual([]);
    expect(
      humanizeWarnings(post("Short. Punchy. Done. That is the whole idea here."), opts()).join(" ")
    ).toContain("fragments");
  });

  it("warns when the opening line runs past the fold", () => {
    const out = humanizeWarnings(
      copyOf({
        blocks: [{ label: "Slide 1", text: "One." }],
        caption: `${"a".repeat(130)}\nand then the rest of it`,
      }),
      opts()
    );
    expect(out.join(" ")).toContain("opening line runs 130");
  });

  it("checks on-screen text too, which is just as published", () => {
    const out = humanizeWarnings(
      copyOf({
        blocks: [
          { label: "Shot 1", text: CLEAN_EN, onScreen: "Comprehensive, robust, nuanced insights." },
        ],
      }),
      opts()
    );
    expect(out.join(" ")).toContain("on screen");
  });
});

describe("humanizeWarnings — severity", () => {
  it("puts a model artifact first, because it is the only one that is simply broken", () => {
    const out = humanizeWarnings(
      post("Our comprehensive insights foster a robust way [Your Name] of working."),
      opts(EN, ["robust"])
    );
    expect(out[0]).toContain("template blank");
    expect(out[0]).toContain("Do not publish");
  });

  it("enforces the client's own list, which four prompts asked for and nothing checked", () => {
    const out = humanizeWarnings(post("We leverage synergy to crush it."), opts(EN, ["synergy", "crush it"]));
    expect(out[0]).toContain("this client's voice says to avoid");
    expect(out[0]).toContain("synergy");
  });

  it("matches an avoided word whatever its case or accent", () => {
    const out = humanizeWarnings(post("Una solución innovadora."), opts(ES, ["Innovadora"]));
    expect(out[0]).toContain("voice says to avoid");
  });

  it("caps what it says and admits how much it left out", () => {
    const bad = post(
      "Let's talk about our comprehensive, robust, nuanced insights. The result? " +
        "Real talk — plot twist — game changer — level up. What do you think? 🎯🔥💡📈 " +
        "Short. Punchy. Done."
    );
    const out = humanizeWarnings(bad, opts());
    expect(out.length).toBe(5);
    expect(out[4]).toContain("more of the same kind");
  });
});
