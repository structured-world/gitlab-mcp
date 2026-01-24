/**
 * Description Utilities for Tool Cross-References
 *
 * Provides dynamic resolution of "Related:" sections in tool descriptions.
 * References to unavailable tools (disabled via USE_*, GITLAB_DENIED_TOOLS_REGEX,
 * tier/version gating, or all-actions-denied) are automatically stripped.
 */

/**
 * Strip "Related:" section references to unavailable tools.
 * If all referenced tools are unavailable, the entire "Related:" clause is removed.
 *
 * Format: "... Related: tool_name purpose, tool_name2 purpose."
 * Multiple items separated by commas. Each starts with a tool name (browse_ or manage_ prefix).
 */
export function resolveRelatedReferences(description: string, availableTools: Set<string>): string {
  const relatedMatch = description.match(/\s*Related:\s*(.+?)\.?\s*$/);
  if (!relatedMatch) return description;

  const matchIndex = relatedMatch.index ?? description.length;
  const baseDescription = description.substring(0, matchIndex);
  const relatedContent = relatedMatch[1];

  // Split by comma, keep only items whose tool is available
  const items = relatedContent.split(",").map(s => s.trim());
  const available = items.filter(item => {
    const toolRef = item.match(/^((?:browse|manage)_\w+)\b/);
    return toolRef && availableTools.has(toolRef[1]);
  });

  if (available.length === 0) {
    return baseDescription.trimEnd();
  }

  return `${baseDescription.trimEnd()} Related: ${available.join(", ")}.`;
}
