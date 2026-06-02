/**
 * Split markdown on H1/H2 boundaries with a lookahead so the heading stays
 * at the top of each chunk. If no H1/H2 headings exist, fall back to
 * paragraph splits — better than returning one giant chunk.
 */
export function chunkByHeadings(md: string): string[] {
  const sections = md
    .split(/(?=^#{1,2}\s)/m)
    .map((s) => s.trim())
    .filter(Boolean);
  if (sections.length > 1) return sections;
  return md
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
}
