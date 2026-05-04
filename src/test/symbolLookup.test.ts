import { dottedSegmentAt, imageAttributesForTag } from '../server/symbolLookup';

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
