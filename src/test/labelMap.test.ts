import { extractLabelsFromText } from '../server/labelMap';

describe('extractLabelsFromText', () => {
	it('captures global labels with no outgoing edges', () => {
		const src = ['label start:', '    "Hello"', '    return'].join('\n');
		const labels = extractLabelsFromText(src);
		expect(labels).toHaveLength(1);
		expect(labels[0]).toMatchObject({ name: 'start', line: 0, isLocal: false, outgoing: [] });
	});

	it('captures outgoing jump and call edges', () => {
		const src = [
			'label start:',       // 0
			'    "Hello"',        // 1
			'    call greet',     // 2
			'    jump ending',    // 3
			'    return',         // 4
		].join('\n');
		const labels = extractLabelsFromText(src);
		expect(labels).toHaveLength(1);
		expect(labels[0].outgoing).toEqual([
			{ kind: 'call', target: 'greet', line: 2 },
			{ kind: 'jump', target: 'ending', line: 3 },
		]);
	});

	it('marks local labels', () => {
		const src = [
			'label outer:',        // 0
			'    "body"',          // 1
			'label .inner:',       // 2
			'    return',          // 3
		].join('\n');
		const labels = extractLabelsFromText(src);
		expect(labels.map(l => ({ name: l.name, isLocal: l.isLocal }))).toEqual([
			{ name: 'outer', isLocal: false },
			{ name: '.inner', isLocal: true },
		]);
	});

	it('attributes outgoing edges to the most recent label', () => {
		const src = [
			'label a:',           // 0
			'    jump b',         // 1
			'label b:',           // 2
			'    jump c',         // 3
		].join('\n');
		const labels = extractLabelsFromText(src);
		expect(labels[0].outgoing).toEqual([{ kind: 'jump', target: 'b', line: 1 }]);
		expect(labels[1].outgoing).toEqual([{ kind: 'jump', target: 'c', line: 3 }]);
	});

	it('ignores `call screen` and `jump/call expression`', () => {
		const src = [
			'label start:',                // 0
			'    call screen save',        // 1
			'    call expression x',       // 2
			'    jump expression y',       // 3
			'    call real_label',         // 4
		].join('\n');
		const labels = extractLabelsFromText(src);
		expect(labels[0].outgoing).toEqual([
			{ kind: 'call', target: 'real_label', line: 4 },
		]);
	});

	it('handles local jump targets', () => {
		const src = [
			'label parent:',       // 0
			'    jump .child',     // 1
			'label .child:',       // 2
			'    return',          // 3
		].join('\n');
		const labels = extractLabelsFromText(src);
		expect(labels[0].outgoing).toMatchObject([{ kind: 'jump', target: '.child', line: 1 }]);
	});

	it('attributes jumps inside a menu choice to the choice text', () => {
		const src = [
			'label start:',                        // 0
			'    menu:',                           // 1
			'        "What next?"',                // 2
			'        "Go left":',                  // 3
			'            jump left_path',          // 4
			'        "Go right":',                 // 5
			'            jump right_path',         // 6
		].join('\n');
		const labels = extractLabelsFromText(src);
		expect(labels[0].outgoing).toMatchObject([
			{ target: 'left_path', menuChoice: 'Go left' },
			{ target: 'right_path', menuChoice: 'Go right' },
		]);
	});

	it('leaves menuChoice undefined for jumps outside a menu', () => {
		const src = [
			'label start:',
			'    jump ending',
		].join('\n');
		const labels = extractLabelsFromText(src);
		expect(labels[0].outgoing[0].menuChoice).toBeUndefined();
	});

	it('does not attribute post-menu jumps to the last menu choice', () => {
		const src = [
			'label start:',                        // 0
			'    menu:',                           // 1
			'        "Choose"',                    // 2
			'        "A":',                        // 3
			'            "did A"',                 // 4
			'    jump epilogue',                   // 5 - outside the menu now
		].join('\n');
		const labels = extractLabelsFromText(src);
		expect(labels[0].outgoing).toMatchObject([
			{ target: 'epilogue' },
		]);
		expect(labels[0].outgoing[0].menuChoice).toBeUndefined();
	});

	it('collects a short preview of the label body', () => {
		const src = [
			'label start:',
			'    # a comment (should be skipped)',
			'    "Hello, world."',
			'    "Second line."',
			'    "Third line."',
			'    return',
		].join('\n');
		const labels = extractLabelsFromText(src);
		expect(labels[0].preview.length).toBeGreaterThan(0);
		expect(labels[0].preview[0]).toBe('"Hello, world."');
		// Comment must not be in preview.
		expect(labels[0].preview.some(l => l.startsWith('#'))).toBe(false);
	});

	it('caps the preview to a small number of lines', () => {
		const bodyLines = Array.from({ length: 20 }, (_, i) => `    "line ${i + 1}"`);
		const src = ['label start:', ...bodyLines, '    return'].join('\n');
		const labels = extractLabelsFromText(src);
		expect(labels[0].preview.length).toBeLessThanOrEqual(5);
	});

	describe('fallthrough detection', () => {
		it('adds a fallthrough edge when a label body does not terminate', () => {
			const src = [
				'label a:',
				'    "hello"',    // no jump/return — falls through
				'label b:',
				'    return',
			].join('\n');
			const labels = extractLabelsFromText(src);
			const fallthroughs = labels[0].outgoing.filter(e => e.kind === 'fallthrough');
			expect(fallthroughs).toEqual([
				{ kind: 'fallthrough', target: 'b', line: 2 },
			]);
		});

		it('does not add fallthrough when body ends with jump', () => {
			const src = [
				'label a:',
				'    jump b',
				'label b:',
				'    return',
			].join('\n');
			const labels = extractLabelsFromText(src);
			const fallthroughs = labels[0].outgoing.filter(e => e.kind === 'fallthrough');
			expect(fallthroughs).toEqual([]);
		});

		it('does not add fallthrough when body ends with return', () => {
			const src = [
				'label a:',
				'    "hi"',
				'    return',
				'label b:',
				'    return',
			].join('\n');
			const labels = extractLabelsFromText(src);
			const fallthroughs = labels[0].outgoing.filter(e => e.kind === 'fallthrough');
			expect(fallthroughs).toEqual([]);
		});

		it('DOES add fallthrough when body ends with call (call returns and falls through)', () => {
			const src = [
				'label a:',
				'    call helper',
				'label b:',
				'    return',
			].join('\n');
			const labels = extractLabelsFromText(src);
			const fallthroughs = labels[0].outgoing.filter(e => e.kind === 'fallthrough');
			expect(fallthroughs).toHaveLength(1);
			expect(fallthroughs[0].target).toBe('b');
		});

		it('does not add fallthrough for the last label in the file', () => {
			const src = [
				'label solo:',
				'    "just this"',
			].join('\n');
			const labels = extractLabelsFromText(src);
			const fallthroughs = labels[0].outgoing.filter(e => e.kind === 'fallthrough');
			expect(fallthroughs).toEqual([]);
		});

		it('does not add fallthrough for an empty label', () => {
			const src = [
				'label empty:',
				'label next:',
				'    return',
			].join('\n');
			const labels = extractLabelsFromText(src);
			const fallthroughs = labels[0].outgoing.filter(e => e.kind === 'fallthrough');
			expect(fallthroughs).toEqual([]);
		});

		it('detects fallthrough even when body contains menu blocks (nested statements do not count)', () => {
			// The last top-level statement is a menu — control flow inside
			// the menu doesn't matter; falling out of the menu falls through.
			const src = [
				'label a:',
				'    menu:',
				'        "opt":',
				'            "did opt"',
				'label b:',
				'    return',
			].join('\n');
			const labels = extractLabelsFromText(src);
			const fallthroughs = labels[0].outgoing.filter(e => e.kind === 'fallthrough');
			expect(fallthroughs).toHaveLength(1);
			expect(fallthroughs[0].target).toBe('b');
		});
	});
});
