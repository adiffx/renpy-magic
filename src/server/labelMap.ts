// Pure helpers for the label-map feature. Kept out of extension.ts so
// they can be unit-tested without pulling in the vscode module.

export interface LabelMapEdge {
	kind: 'jump' | 'call' | 'fallthrough';
	target: string;
	line: number;
	// When the edge originates from a `menu:` choice, this holds the
	// unquoted choice text (e.g. `"Head back to the kiosk"` → `Head back to the kiosk`).
	menuChoice?: string;
}

export interface LabelMapEntry {
	name: string;
	line: number;
	isLocal: boolean;
	outgoing: LabelMapEdge[];
	// First few significant lines of the label body, for hover preview.
	// Empty when the label has no body (or only structural statements).
	preview: string[];
}

// Number of significant lines to keep for the hover preview.
const PREVIEW_LINE_COUNT = 5;

// Scan a Ren'Py file's text and return every label plus its outgoing
// jump/call edges, plus a short body preview. Local labels
// (`label .foo:`) are attributed to the preceding global label by
// callers.
export function extractLabelsFromText(text: string): LabelMapEntry[] {
	const lines = text.split('\n');
	const labels: LabelMapEntry[] = [];
	let current: LabelMapEntry | null = null;
	let currentIndent = 0;

	// Fall-through tracking: for each label, remember the kind of the
	// last top-level statement at the label's body indent. If that
	// statement is not a flow terminator (`jump`, `call`, `return`),
	// execution falls through to the next label. `bodyIndent` is
	// established the first time we see a body line for the label.
	const lastTopKind: Array<'jump' | 'call' | 'return' | 'other' | 'none'> = [];
	const bodyIndentOf: Array<number | undefined> = [];

	// Menu tracking. `menuStack` holds the indent of each open menu so we
	// can attribute jumps inside a choice to the last-seen choice text.
	// When we descend below a menu's indent, that menu is popped.
	interface MenuFrame {
		menuIndent: number;      // indent of the `menu:` line
		choiceIndent?: number;   // indent of the choice string lines
		currentChoice?: string;  // most recently seen choice text
	}
	let menuStack: MenuFrame[] = [];

	const indentOf = (raw: string): number => (raw.match(/^\s*/)?.[0].length) ?? 0;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const trimmed = line.trim();
		if (!trimmed) continue;
		if (trimmed.startsWith('#')) continue;

		const indent = indentOf(line);

		const labelMatch = line.match(/^(\s*)label\s+(\.?[a-zA-Z_][a-zA-Z0-9_.]*)/);
		if (labelMatch) {
			const name = labelMatch[2];
			current = { name, line: i, isLocal: name.startsWith('.'), outgoing: [], preview: [] };
			currentIndent = labelMatch[1].length;
			labels.push(current);
			lastTopKind.push('none');
			bodyIndentOf.push(undefined);
			menuStack = [];
			continue;
		}
		if (!current) continue;

		// Reset menu context when we've dedented out of it.
		while (menuStack.length && indent <= menuStack[menuStack.length - 1].menuIndent) {
			menuStack.pop();
		}

		// Establish the label's body indent the first time we see a body line.
		const labelIdx = labels.length - 1;
		if (bodyIndentOf[labelIdx] === undefined && indent > currentIndent) {
			bodyIndentOf[labelIdx] = indent;
		}

		// Update lastTopKind when we see a statement at the label's body indent.
		// Statements inside nested blocks (deeper indent) don't count.
		if (indent === bodyIndentOf[labelIdx]) {
			if (/^(jump)\b/.test(trimmed)) lastTopKind[labelIdx] = 'jump';
			else if (/^(call)\b/.test(trimmed)) lastTopKind[labelIdx] = 'call';
			else if (/^return\b/.test(trimmed)) lastTopKind[labelIdx] = 'return';
			else lastTopKind[labelIdx] = 'other';
		}

		// Detect the start of a menu block.
		const menuMatch = trimmed.match(/^menu(?:\s+\w+)?\s*:$/);
		if (menuMatch) {
			menuStack.push({ menuIndent: indent });
			continue;
		}

		// Inside an active menu, detect a choice line: a quoted string
		// (with optional `if` guard) followed by `:`.
		if (menuStack.length) {
			const top = menuStack[menuStack.length - 1];
			// Choices sit one indent step below the `menu:` line.
			if (indent > top.menuIndent) {
				const choiceMatch = trimmed.match(/^(?:"([^"]*)"|'([^']*)')(?:\s+if\s+.+)?\s*:\s*$/);
				if (choiceMatch) {
					top.currentChoice = choiceMatch[1] ?? choiceMatch[2];
					top.choiceIndent = indent;
				}
			}
		}

		// Outgoing jump/call.
		const jumpCallMatch = line.match(/^\s*(jump|call)\s+(\.?[a-zA-Z_][a-zA-Z0-9_.]*)/);
		if (jumpCallMatch) {
			const target = jumpCallMatch[2];
			if (target !== 'screen' && target !== 'expression') {
				const edge: LabelMapEdge = {
					kind: jumpCallMatch[1] as 'jump' | 'call',
					target,
					line: i,
				};
				// If we're inside a menu choice body, attach the choice text.
				const activeMenu = menuStack[menuStack.length - 1];
				if (activeMenu?.currentChoice && activeMenu.choiceIndent !== undefined && indent > activeMenu.choiceIndent) {
					edge.menuChoice = activeMenu.currentChoice;
				}
				current.outgoing.push(edge);
			}
		}

		// Preview: collect the first N significant lines of the label body.
		if (current.preview.length < PREVIEW_LINE_COUNT && indent > currentIndent) {
			current.preview.push(trimmed);
		}
	}

	// Second pass: add fall-through edges. A label falls through into the
	// next label when its last top-level statement isn't a terminator.
	// `jump` and `return` terminate; `call` doesn't (it returns and
	// execution continues); anything else is control-flow neutral and
	// therefore falls through. Skipped for the last label (nothing follows)
	// and empty labels.
	for (let idx = 0; idx < labels.length - 1; idx++) {
		const kind = lastTopKind[idx];
		if (kind === 'jump' || kind === 'return' || kind === 'none') continue;
		const nextLabel = labels[idx + 1];
		labels[idx].outgoing.push({
			kind: 'fallthrough',
			target: nextLabel.name,
			line: nextLabel.line, // point at the receiving label's def line
		});
	}

	return labels;
}
