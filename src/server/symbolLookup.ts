// For a `label X:` at `defLine`, return the [start, end) range of line
// indices that belong to the label body. The body ends at the next line
// whose indentation is <= the label's own and that isn't blank/comment-only.
export function labelBodyRange(lines: string[], defLine: number): { start: number; end: number } {
	const defMatch = lines[defLine]?.match(/^(\s*)label\s+/);
	const defIndent = defMatch ? defMatch[1].length : 0;
	let end = lines.length;
	for (let i = defLine + 1; i < lines.length; i++) {
		const raw = lines[i];
		const trimmed = raw.trim();
		if (!trimmed || trimmed.startsWith('#')) continue;
		const indentMatch = raw.match(/^(\s*)/);
		const indent = indentMatch ? indentMatch[1].length : 0;
		if (indent <= defIndent) {
			end = i;
			break;
		}
	}
	return { start: defLine + 1, end };
}

// Find the nearest preceding label definition (`label X:`) walking
// backward from `line`. Returns null if none is found. If
// `globalOnly` is true, local labels (starting with `.`) are skipped.
export function findEnclosingLabel(
	lines: string[],
	line: number,
	globalOnly: boolean = true
): { name: string; defLine: number } | null {
	for (let i = Math.min(line, lines.length - 1); i >= 0; i--) {
		const m = lines[i].match(/^(\s*)label\s+(\.?[a-zA-Z_][a-zA-Z0-9_.]*)/);
		if (!m) continue;
		if (globalOnly && m[2].startsWith('.')) continue;
		return { name: m[2], defLine: i };
	}
	return null;
}

// Given a list of full image names (e.g. ["kelly_casual ch06 smile",
// "eileen happy", "bg ch01 hallway"]) return the deduped set of image
// tags (the first word of each name). Used for completion of the first
// token after `show|scene|hide `. Single-word names are also included
// since they may be used standalone (e.g. `show vignette`).
export function imageTags(imageNames: Iterable<string>): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const name of imageNames) {
		const tag = name.split(/\s+/)[0];
		if (!tag || seen.has(tag)) continue;
		seen.add(tag);
		out.push(tag);
	}
	return out;
}

// Given a list of full image names (e.g. ["kelly_casual ch06 smile",
// "kelly_casual ch06 teasing", "eileen happy"]) and a tag, return the
// deduped attributes that appear after that tag. Used for completion
// after `show <tag> ` and similar. Already-used attributes (passed as
// `exclude`) are filtered out so the same attribute isn't suggested twice.
export function imageAttributesForTag(
	imageNames: Iterable<string>,
	tag: string,
	exclude: Iterable<string> = []
): string[] {
	const excludeSet = new Set(exclude);
	const seen = new Set<string>();
	const out: string[] = [];
	for (const name of imageNames) {
		const parts = name.split(/\s+/);
		if (parts.length < 2 || parts[0] !== tag) continue;
		for (let i = 1; i < parts.length; i++) {
			const attr = parts[i];
			if (excludeSet.has(attr) || seen.has(attr)) continue;
			seen.add(attr);
			out.push(attr);
		}
	}
	return out;
}

// Given a dotted expression like "CHAPTER_TITLES.get" and an offset within
// that expression, return the dot-separated segment containing the offset
// (e.g. "CHAPTER_TITLES" if the cursor is on it). Returns null when the
// expression has no dots or the offset is outside the string.
export function dottedSegmentAt(expr: string, offsetInExpr: number): string | null {
	if (!expr.includes('.')) return null;
	if (offsetInExpr < 0 || offsetInExpr > expr.length) return null;
	let segStart = 0;
	for (let i = 0; i <= expr.length; i++) {
		if (i === expr.length || expr[i] === '.') {
			if (offsetInExpr >= segStart && offsetInExpr <= i) {
				return expr.substring(segStart, i) || null;
			}
			segStart = i + 1;
		}
	}
	return null;
}
