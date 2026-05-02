// Asset path extraction from Ren'Py definitions.
//
// Ren'Py definitions can place a quoted asset path bare on the right-hand side
// of `=` (`image x = "path.png"`), inside a wrapper (`image x = Transform("path.png", ...)`),
// or spread across multiple lines (`image x = ConditionSwitch(\n    "...", "path.jpg",\n    ...)`).
// This module extracts the first quoted asset path from any of these shapes.

export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'mp4', 'webm', 'ogv', 'avi', 'mkv'];
export const AUDIO_EXTENSIONS = ['ogg', 'mp3', 'wav', 'opus', 'flac', 'm4a'];

function buildAssetRegex(extensions: string[]): RegExp {
	const alt = extensions.join('|');
	return new RegExp(`["']([^"']+\\.(?:${alt}))["']`, 'i');
}

// Extract the first quoted asset path on the right-hand side of `=` for the
// definition starting at `lines[startLine]`. Continuation lines are scanned
// when the first line opens an unbalanced `(` without yielding a path,
// stopping when the parens balance or a path is found.
export function extractAssetPath(
	lines: string[],
	startLine: number,
	extensions: string[],
	maxLookahead = 50
): string | null {
	const line = lines[startLine];
	if (line === undefined) return null;
	const eqIdx = line.indexOf('=');
	if (eqIdx < 0) return null;

	const assetRegex = buildAssetRegex(extensions);
	let rhs = line.substring(eqIdx + 1);
	let m = rhs.match(assetRegex);

	const opensMulti = rhs.includes('(') && !rhs.match(/\)\s*$/);
	if (!m && opensMulti) {
		for (let j = startLine + 1; j < lines.length && j < startLine + maxLookahead; j++) {
			rhs += '\n' + lines[j];
			m = rhs.match(assetRegex);
			if (m) break;
			let depth = 0;
			for (const ch of rhs) {
				if (ch === '(') depth++;
				else if (ch === ')') depth--;
			}
			if (depth <= 0) break;
		}
	}
	return m ? m[1] : null;
}
