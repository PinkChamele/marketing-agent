/**
 * Maximum chars allowed in a single section's content. Sections larger than
 * this are sliced and marked `truncated: true`. 30k chars (~7.5k tokens) is
 * the threshold: any single section that big is almost certainly a
 * poorly-structured page where the real content is buried in one prose dump.
 * The agent can recover the rest via `find-in-page` on the cached full page.
 */
export const MAX_SECTION_CHARS = 30_000;
