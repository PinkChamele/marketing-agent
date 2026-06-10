/**
 * Marker string for skipped scorer runs. Scorers prepend this to their
 * `generateReason` output so downstream dashboards can filter "didn't
 * evaluate" rows from "evaluated and scored low" rows.
 */
export const SKIPPED_REASON_PREFIX = 'SKIPPED:';

export const INCOMPLETE_MSG = `${SKIPPED_REASON_PREFIX} agent did not produce a final report.`;

export const MIN_REPORT_LENGTH = 800;
export const MIN_SECTION_HITS = 3;

/**
 * Patterns indicating a model emitted a tool call as text content instead of
 * using the function-calling protocol — Gemma-style `<|tool_call|>` template
 * tokens, Llama-style `<tool_call>...</tool_call>` XML wrappers, raw
 * `<function=...>` parameter tags.
 */
export const TOOL_CALL_LEAK_PATTERNS = [
  /<\|tool_call/i,
  /<\|im_start\|>/i,
  /<tool_call>/i,
  /<function\s*=/i,
];

export const GARBAGE_PATTERNS = [
  ...TOOL_CALL_LEAK_PATTERNS,
  /\[object Object\]/,
  /"inputMessages"\s*:/,
  /"systemMessages"\s*:/,
];

// Heading prefix tolerant of both ATX (`##`) and bold-wrapped (`**…**`)
// styles, with optional numbering (`1.`, `2)`). The synthesizer's
// instructions present sections in bold, so the actual reports use
// `**Executive Summary**` — not `## Executive Summary`. Matching only ATX
// caused every scorer to short-circuit with "didn't produce a final report".
const HEADING_PREFIX = String.raw`^\s*(?:#{1,6}\s*)?(?:\*\*|__)?\s*\d?[.)\s]*`;
const BOLD_CLOSE = String.raw`(?:\*\*|__)?\s*`;

/**
 * Sources-section heading. Anchored to end-of-line so prose mentions of
 * "sources" don't trip the match. Used by `isFinalReport` (via
 * `EXPECTED_SECTION_PATTERNS`) and by `citation-integrity`'s body/sources
 * splitter, so the two scorers share a single definition.
 */
export const SOURCES_HEADING = new RegExp(
  HEADING_PREFIX + String.raw`sources?` + BOLD_CLOSE + String.raw`$`,
  'im',
);

/**
 * Expected section headers in the synthesizer's final report. A report must
 * hit at least `MIN_SECTION_HITS` of these to pass the `isFinalReport` gate.
 */
export const EXPECTED_SECTION_PATTERNS = [
  new RegExp(HEADING_PREFIX + String.raw`executive\s+summary`, 'im'),
  new RegExp(HEADING_PREFIX + String.raw`market\s+trends`, 'im'),
  new RegExp(HEADING_PREFIX + String.raw`competitor`, 'im'),
  new RegExp(HEADING_PREFIX + String.raw`(?:candidate\s+)?icps?`, 'im'),
  new RegExp(HEADING_PREFIX + String.raw`fit\s+analysis`, 'im'),
  new RegExp(HEADING_PREFIX + String.raw`positioning`, 'im'),
  new RegExp(HEADING_PREFIX + String.raw`confidence`, 'im'),
  SOURCES_HEADING,
];
