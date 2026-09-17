import { copySections, type SlotCopy } from "@/lib/marketing/copy";
import { surface, text } from "@/lib/ui";

/**
 * The finished copy, read-only.
 *
 * Driven by copySections rather than reaching into the SlotCopy shape, so the
 * selection and ordering rules — headline first, blocks in order, caption and
 * hashtags after, `note` folded in as direction — live in one tested place and
 * every surface shows the same words in the same order.
 *
 * Extracted when stage ② Content needed to show copy before a plan is accepted.
 * The slot detail page still renders its own, which is styled for a full page
 * rather than a card; converting it is a separate change, deliberately not
 * bundled here.
 */
export function CopyView({ copy }: { copy: SlotCopy }) {
  const sections = copySections(copy);

  return (
    <div className={`${surface.inset} space-y-3`}>
      {sections.map((section, i) => (
        <div key={`${section.label}-${i}`}>
          <p className={text.micro}>{section.label}</p>
          {/* whitespace-pre-wrap: the model writes line breaks inside a block
              and they are part of the copy, not formatting we are free to drop. */}
          <p className="text-sm text-slate-800 whitespace-pre-wrap">{section.text}</p>
          {section.note && (
            <p className="mt-0.5 text-xs italic text-slate-500">{section.note}</p>
          )}
        </div>
      ))}
    </div>
  );
}
