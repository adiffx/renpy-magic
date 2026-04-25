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
