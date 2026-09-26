export interface InteractiveChoice {
  id: string;
  label: string;
  value: string;
  variant?: 'primary' | 'secondary' | 'danger';
}

/**
 * Extracts interactive one-click response choices from an assistant message.
 * Supports:
 * 1. Bracketed options: [Option A: Extract into public_html], [Yes, proceed], [Cancel]
 * 2. Natural option lines: Option A — Summary (Reply "yes to authorize...")
 * 3. Numbered lists: 1. Extract archive, 2. Inspect first, 3. Cancel
 * 4. Confirmation prompts: "Reply 'yes' to proceed", "Would you like me to proceed?"
 */
export function extractInteractiveChoices(text: string): InteractiveChoice[] {
  if (!text || typeof text !== 'string') return [];
  const choices: InteractiveChoice[] = [];
  const seenValues = new Set<string>();

  const add = (label: string, value: string, variant: 'primary' | 'secondary' | 'danger' = 'secondary') => {
    const cleanLabel = label.trim().replace(/^[*_`#\-\s]+|[*_`#\-\s]+$/g, '');
    const cleanVal = (value || label).trim().replace(/^[*_`#\-\s]+|[*_`#\-\s]+$/g, '');
    if (!cleanLabel || cleanLabel.length < 2) return;
    const lower = cleanVal.toLowerCase();
    if (seenValues.has(lower)) return;
    seenValues.add(lower);
    choices.push({
      id: `choice-${choices.length}`,
      label: cleanLabel,
      value: cleanVal,
      variant,
    });
  };

  // 1. Explicit bracketed options: [Option A: ...], [Path: ...], [Use ...], [Yes, proceed], [Confirm], [Cancel]
  const bracketMatches = Array.from(
    text.matchAll(/\[(Option\s+[A-Za-z0-9]+:?[^\]]+|Path:?[^\]]+|Use\s+[^\]]+|Select\s+[^\]]+|Yes[^\]]*|No[^\]]*|Confirm[^\]]*|Cancel[^\]]*|Proceed[^\]]*|Extract[^\]]*|Inspect[^\]]*)\]/gi)
  );
  for (const m of bracketMatches) {
    const raw = m[1].trim();
    const isYes = /^(yes|confirm|proceed|approve|extract)/i.test(raw);
    const isNo = /^(no|cancel|abort|reject)/i.test(raw);
    add(raw, raw, isYes ? 'primary' : isNo ? 'danger' : 'secondary');
  }

  // 2. Natural Option Lines: "Option A — Summary" or "- Option A: Summary"
  if (choices.length === 0) {
    const optionLines = Array.from(
      text.matchAll(/(?:^|\n)\s*[-*•]?\s*\**Option\s+([A-Za-z0-9]+)\**\s*[:—–-]\s*([^\n\r.]+)/gi)
    );
    for (const m of optionLines) {
      const optLetter = m[1].toUpperCase();
      const summary = m[2].trim().slice(0, 48);

      // Search ahead in the text snippet for an explicit reply phrase like: Reply "yes — check..."
      const lineIndex = m.index ?? 0;
      const snippet = text.slice(lineIndex, lineIndex + 220);
      const replyMatch = snippet.match(/Reply\s+["'“]([^"'”]+)["'”]/i);
      const val = replyMatch ? replyMatch[1].trim() : `Option ${optLetter}`;

      add(`Option ${optLetter}: ${summary}`, val, 'secondary');
    }
  }

  // 3. Numbered lists (1. ... or 1) ...) in decision/selection contexts
  const hasChoiceContext = /choose|select|option|which|prefer|proceed|how would you like|options:/i.test(text);
  if (choices.length === 0 && hasChoiceContext) {
    const numberedLines = Array.from(text.matchAll(/(?:^|\n)\s*(\d+)[\.)]\s+([^\n\r]+)/g));
    for (const m of numberedLines) {
      const num = m[1];
      const desc = m[2].trim().slice(0, 50);
      if (desc.length > 2 && !desc.startsWith('http') && !desc.includes('=')) {
        const isCancel = /cancel|abort|stop/i.test(desc);
        add(`${num}. ${desc}`, `${num}. ${desc}`, isCancel ? 'danger' : 'secondary');
      }
    }
  }

  // 4. Yes/No Confirmation prompts
  if (choices.length === 0) {
    const hasYesNoPrompt =
      /reply\s+["'“]yes["'”]|would you like me to proceed|do you want me to proceed|confirm and proceed|do you authorize|shall i proceed|shall i extract/i.test(
        text
      );
    if (hasYesNoPrompt) {
      add('Yes, proceed', 'Yes, please proceed', 'primary');
      add('No, cancel', 'No, cancel', 'danger');
    }
  }

  return choices.slice(0, 6);
}
