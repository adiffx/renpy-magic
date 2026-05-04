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
