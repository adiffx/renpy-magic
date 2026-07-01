import { dottedSegmentAt, imageAttributesForTag, imageTags, labelBodyRange, findEnclosingLabel } from '../server/symbolLookup';

describe('dottedSegmentAt', () => {
	it('returns null for non-dotted expressions', () => {
		expect(dottedSegmentAt('CHAPTER_TITLES', 5)).toBeNull();
	});

	it('returns the first segment when the cursor is on it', () => {
		const expr = 'CHAPTER_TITLES.get';
		// Cursor anywhere inside "CHAPTER_TITLES" (offsets 0..14, including the dot boundary)
		expect(dottedSegmentAt(expr, 0)).toBe('CHAPTER_TITLES');
		expect(dottedSegmentAt(expr, 7)).toBe('CHAPTER_TITLES');
		expect(dottedSegmentAt(expr, 14)).toBe('CHAPTER_TITLES');
	});

	it('returns the trailing segment when the cursor is past the dot', () => {
		const expr = 'CHAPTER_TITLES.get';
		// "get" starts at offset 15
		expect(dottedSegmentAt(expr, 15)).toBe('get');
		expect(dottedSegmentAt(expr, 17)).toBe('get');
		expect(dottedSegmentAt(expr, 18)).toBe('get');
	});

	it('returns the middle segment for chained access', () => {
		const expr = 'a.b.c';
		expect(dottedSegmentAt(expr, 0)).toBe('a');
		// "b" sits between offsets 2 and 3
		expect(dottedSegmentAt(expr, 2)).toBe('b');
		expect(dottedSegmentAt(expr, 3)).toBe('b');
		// "c" starts at offset 4
		expect(dottedSegmentAt(expr, 4)).toBe('c');
		expect(dottedSegmentAt(expr, 5)).toBe('c');
	});

	it('handles namespaced defines like gui.text_color', () => {
		const expr = 'gui.text_color';
		expect(dottedSegmentAt(expr, 1)).toBe('gui');
		expect(dottedSegmentAt(expr, 5)).toBe('text_color');
	});

	it('returns null when the offset is outside the expression', () => {
		expect(dottedSegmentAt('a.b', -1)).toBeNull();
		expect(dottedSegmentAt('a.b', 4)).toBeNull();
	});

	it('returns null for empty segments', () => {
		// Cursor sits on the dot in ".get" — the leading segment is empty
		expect(dottedSegmentAt('.get', 0)).toBeNull();
	});
});

describe('imageAttributesForTag', () => {
	it('returns the deduped attributes for a tag', () => {
		const names = [
			'kelly_casual ch06 smile',
			'kelly_casual ch06 teasing',
			'kelly_casual ch06 focussed',
			'eileen happy',
		];
		const attrs = imageAttributesForTag(names, 'kelly_casual');
		expect(attrs).toContain('smile');
		expect(attrs).toContain('teasing');
		expect(attrs).toContain('focussed');
		expect(attrs).toContain('ch06');
		// Each attribute appears once even though `ch06` is in three images
		expect(attrs.filter(a => a === 'ch06')).toHaveLength(1);
		// Attributes from the `eileen` tag are not included
		expect(attrs).not.toContain('happy');
	});

	it('returns an empty list for an unknown tag', () => {
		const names = ['kelly_casual ch06 smile'];
		expect(imageAttributesForTag(names, 'unknown_tag')).toEqual([]);
	});

	it('skips entries that are tag-only (no attributes)', () => {
		const names = ['kelly_casual', 'kelly_casual ch06 smile'];
		const attrs = imageAttributesForTag(names, 'kelly_casual');
		expect(attrs).toEqual(['ch06', 'smile']);
	});

	it('handles two-part images (no chapter prefix)', () => {
		const names = ['eileen happy', 'eileen sad', 'eileen angry'];
		const attrs = imageAttributesForTag(names, 'eileen');
		expect(attrs.sort()).toEqual(['angry', 'happy', 'sad']);
	});

	it('excludes attributes already used on the line', () => {
		const names = [
			'kelly_casual ch06 smile',
			'kelly_casual ch06 teasing',
		];
		const attrs = imageAttributesForTag(names, 'kelly_casual', ['ch06']);
		expect(attrs).not.toContain('ch06');
		expect(attrs).toContain('smile');
		expect(attrs).toContain('teasing');
	});
});

describe('imageTags', () => {
	it('returns the deduped first-word of each image name', () => {
		const names = [
			'kelly_casual ch06 smile',
			'kelly_casual ch06 teasing',
			'kelly_tennis ch06 smile',
			'eileen happy',
			'bg ch01 hallway',
			'cg ch01 almost_kiss',
		];
		const tags = imageTags(names);
		expect(tags.sort()).toEqual(['bg', 'cg', 'eileen', 'kelly_casual', 'kelly_tennis']);
	});

	it('includes single-word names (no attribute)', () => {
		const names = ['vignette', 'black'];
		expect(imageTags(names).sort()).toEqual(['black', 'vignette']);
	});

	it('returns an empty list for no images', () => {
		expect(imageTags([])).toEqual([]);
	});

	it('preserves first-seen order', () => {
		const names = ['cg ch01 a', 'bg ch01 b', 'cg ch02 c'];
		// `cg` first because that's the first name we see, then `bg`.
		expect(imageTags(names)).toEqual(['cg', 'bg']);
	});
});

describe('labelBodyRange', () => {
	it('returns the body of a top-level label', () => {
		const lines = [
			'label start:',        // 0
			'    scene bg room',   // 1
			'    "Hello"',         // 2
			'    return',          // 3
			'',                    // 4
			'label chapter_two:',  // 5
			'    "Next"',          // 6
		];
		const range = labelBodyRange(lines, 0);
		expect(range).toEqual({ start: 1, end: 5 });
	});

	it('skips blank and comment-only lines when finding the end', () => {
		const lines = [
			'label start:',      // 0
			'    "Hi"',          // 1
			'',                  // 2 (blank)
			'    # comment',     // 3 (comment)
			'    "Bye"',         // 4
			'label next:',       // 5
			'    "Next"',        // 6
		];
		const range = labelBodyRange(lines, 0);
		expect(range).toEqual({ start: 1, end: 5 });
	});

	it('runs to end of file when there is no following same-indent line', () => {
		const lines = [
			'label solo:',       // 0
			'    "A"',           // 1
			'    "B"',           // 2
		];
		const range = labelBodyRange(lines, 0);
		expect(range).toEqual({ start: 1, end: 3 });
	});
});

describe('findEnclosingLabel', () => {
	it('finds the label at the given line', () => {
		const lines = [
			'label start:',      // 0
			'    "Hi"',          // 1
			'    jump next',     // 2
		];
		expect(findEnclosingLabel(lines, 2)).toEqual({ name: 'start', defLine: 0 });
	});

	it('returns null when no preceding label exists', () => {
		const lines = [
			'# just a comment',
			'"floating text"',
		];
		expect(findEnclosingLabel(lines, 1)).toBeNull();
	});

	it('skips local labels (starting with .)', () => {
		const lines = [
			'label outer:',        // 0
			'    "Body"',          // 1
			'label .inner:',       // 2 - local, should be skipped
			'    jump target',     // 3
		];
		expect(findEnclosingLabel(lines, 3)).toEqual({ name: 'outer', defLine: 0 });
	});

	it('picks the nearest preceding global label', () => {
		const lines = [
			'label first:',      // 0
			'    "A"',           // 1
			'label second:',     // 2
			'    "B"',           // 3
			'    jump third',    // 4
		];
		expect(findEnclosingLabel(lines, 4)).toEqual({ name: 'second', defLine: 2 });
	});

	it('returns the nearest local label when globalOnly is false', () => {
		const lines = [
			'label outer:',        // 0
			'    "body"',          // 1
			'label .inner:',       // 2 - local
			'    jump target',     // 3
		];
		// Default (globalOnly=true) skips locals — the enclosing is `outer`.
		expect(findEnclosingLabel(lines, 3)).toEqual({ name: 'outer', defLine: 0 });
		// With globalOnly=false, the nearest is `.inner`.
		expect(findEnclosingLabel(lines, 3, false)).toEqual({ name: '.inner', defLine: 2 });
	});
});
