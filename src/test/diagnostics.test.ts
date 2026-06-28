// Helper functions extracted from server.ts for testing
function isInComment(line: string): boolean {
	const trimmed = line.trim();
	return trimmed.startsWith('#') || trimmed.startsWith('##');
}

function isInMultilineString(lines: string[], lineIndex: number): boolean {
	let tripleQuoteCount = 0;
	for (let i = 0; i < lineIndex; i++) {
		const matches = lines[i].match(/"""/g);
		if (matches) {
			tripleQuoteCount += matches.length;
		}
	}
	return tripleQuoteCount % 2 !== 0;
}

// Built-in screens
const builtinScreens = new Set([
	'say', 'input', 'choice', 'nvl', 'notify', 'skip_indicator',
	'ctc', 'save', 'load', 'preferences', 'main_menu', 'game_menu',
	'navigation', 'about', 'help', 'keyboard_help', 'mouse_help',
	'gamepad_help', 'confirm', 'history', 'quick_menu'
]);

// Built-in images
const builtinImages = new Set([
	'black', 'white', 'transparent'
]);

describe('Comment Detection', () => {
	it('should detect lines starting with #', () => {
		expect(isInComment('# This is a comment')).toBe(true);
		expect(isInComment('  # Indented comment')).toBe(true);
		expect(isInComment('## Double hash comment')).toBe(true);
	});

	it('should not detect non-comment lines', () => {
		expect(isInComment('label start:')).toBe(false);
		expect(isInComment('  jump somewhere')).toBe(false);
		expect(isInComment('show cg image # inline comment')).toBe(false);
	});
});

describe('Multiline String Detection', () => {
	it('should detect when inside a triple-quoted string', () => {
		const lines = [
			'def myfunction():',
			'    """',
			'    This is a docstring',
			'    """',
			'    pass'
		];
		expect(isInMultilineString(lines, 0)).toBe(false);
		expect(isInMultilineString(lines, 1)).toBe(false);
		expect(isInMultilineString(lines, 2)).toBe(true);  // Inside docstring
		expect(isInMultilineString(lines, 3)).toBe(true);  // Still inside (closing on this line)
		expect(isInMultilineString(lines, 4)).toBe(false); // After docstring
	});

	it('should handle multiple triple-quoted strings', () => {
		const lines = [
			'"""First docstring"""',
			'code here',
			'"""Second docstring"""',
			'more code'
		];
		expect(isInMultilineString(lines, 0)).toBe(false);
		expect(isInMultilineString(lines, 1)).toBe(false);
		expect(isInMultilineString(lines, 2)).toBe(false);
		expect(isInMultilineString(lines, 3)).toBe(false);
	});
});

describe('Built-in Screens', () => {
	it('should recognize common built-in screens', () => {
		expect(builtinScreens.has('save')).toBe(true);
		expect(builtinScreens.has('load')).toBe(true);
		expect(builtinScreens.has('preferences')).toBe(true);
		expect(builtinScreens.has('main_menu')).toBe(true);
		expect(builtinScreens.has('game_menu')).toBe(true);
		expect(builtinScreens.has('confirm')).toBe(true);
		expect(builtinScreens.has('history')).toBe(true);
	});

	it('should not recognize non-built-in screens', () => {
		expect(builtinScreens.has('my_custom_screen')).toBe(false);
		expect(builtinScreens.has('inventory')).toBe(false);
	});
});

describe('Built-in Images', () => {
	it('should recognize built-in images', () => {
		expect(builtinImages.has('black')).toBe(true);
		expect(builtinImages.has('white')).toBe(true);
		expect(builtinImages.has('transparent')).toBe(true);
	});

	it('should not recognize non-built-in images', () => {
		expect(builtinImages.has('red')).toBe(false);
		expect(builtinImages.has('my_image')).toBe(false);
	});
});

describe('Label Pattern Matching', () => {
	const labelRegex = /^(\s*)(label)\s+(\.?[a-zA-Z_][a-zA-Z0-9_.]*)/;

	it('should match global labels', () => {
		const match = 'label start:'.match(labelRegex);
		expect(match).not.toBeNull();
		expect(match![3]).toBe('start');
	});

	it('should match labels with underscores', () => {
		const match = 'label chapter_01_intro:'.match(labelRegex);
		expect(match).not.toBeNull();
		expect(match![3]).toBe('chapter_01_intro');
	});

	it('should match local labels', () => {
		const match = '    label .ending:'.match(labelRegex);
		expect(match).not.toBeNull();
		expect(match![3]).toBe('.ending');
	});

	it('should match labels with parameters', () => {
		const match = 'label init_chapter(number):'.match(labelRegex);
		expect(match).not.toBeNull();
		// Note: parameters are not captured in the basic regex
		expect(match![3]).toBe('init_chapter');
	});
});

describe('Jump/Call Pattern Matching', () => {
	const jumpRegex = /^\s*(jump|call)\s+(\.?[a-zA-Z_][a-zA-Z0-9_.]*)/;

	it('should match jump statements', () => {
		const match = '    jump chapter_02'.match(jumpRegex);
		expect(match).not.toBeNull();
		expect(match![1]).toBe('jump');
		expect(match![2]).toBe('chapter_02');
	});

	it('should match call statements', () => {
		const match = '    call helper_function'.match(jumpRegex);
		expect(match).not.toBeNull();
		expect(match![1]).toBe('call');
		expect(match![2]).toBe('helper_function');
	});

	it('should match local label references', () => {
		const match = '    jump .intro'.match(jumpRegex);
		expect(match).not.toBeNull();
		expect(match![2]).toBe('.intro');
	});

	it('should NOT match call screen (handled separately)', () => {
		// The regex should still match, but the handler should check for "screen" keyword
		const match = '    call screen save'.match(jumpRegex);
		expect(match).not.toBeNull();
		expect(match![2]).toBe('screen');
		// This is why we need negative lookahead in completions
	});

	describe('call/jump expression detection', () => {
		// `call expression <expr>` and `jump expression <expr>` evaluate a
		// Python expression at runtime — `expression` is a keyword, not a
		// label, so the undefined-label diagnostic must skip these lines.
		const callExpressionRegex = /^\s*(jump|call)\s+expression\b/;

		it('matches `call expression _item["label"]`', () => {
			const m = '    call expression _item["label"]'.match(callExpressionRegex);
			expect(m).not.toBeNull();
			expect(m![1]).toBe('call');
		});

		it('matches `jump expression target`', () => {
			expect('    jump expression target'.match(callExpressionRegex)).not.toBeNull();
		});

		it('does NOT match plain `call expression_helper`', () => {
			// Ensure `\b` boundary prevents matching labels that happen to
			// start with `expression`.
			expect('    call expression_helper'.match(callExpressionRegex)).toBeNull();
		});

		it('does NOT match `call my_label`', () => {
			expect('    call my_label'.match(callExpressionRegex)).toBeNull();
		});
	});
});

describe('Call Screen Pattern Matching', () => {
	const callScreenRegex = /^\s*call\s+screen\s+([a-zA-Z_][a-zA-Z0-9_]*)/;

	it('should match call screen statements', () => {
		const match = '    call screen save'.match(callScreenRegex);
		expect(match).not.toBeNull();
		expect(match![1]).toBe('save');
	});

	it('should match call screen with custom screen', () => {
		const match = '    call screen my_inventory'.match(callScreenRegex);
		expect(match).not.toBeNull();
		expect(match![1]).toBe('my_inventory');
	});
});

describe('Use Screen Pattern Matching', () => {
	const useRegex = /^(\s*)use\s+([a-zA-Z_][a-zA-Z0-9_]*)(?:\s*\(|\s*$|\s*:)/;

	it('should match use screen statements', () => {
		const match = '        use navigation'.match(useRegex);
		expect(match).not.toBeNull();
		expect(match![2]).toBe('navigation');
	});

	it('should match use screen with arguments', () => {
		const match = '        use header("Title")'.match(useRegex);
		expect(match).not.toBeNull();
		expect(match![2]).toBe('header');
	});

	it('should NOT match "use it" in comments', () => {
		// "use it" doesn't end with ( or : or end of line, so it won't match
		const match = '## uncomment a line below and use it'.match(useRegex);
		expect(match).toBeNull();
	});
});

describe('Function Definition Pattern Matching', () => {
	const funcRegex = /def\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(([^)]*)\)/;

	it('should match simple function definitions', () => {
		const match = '    def my_function():'.match(funcRegex);
		expect(match).not.toBeNull();
		expect(match![1]).toBe('my_function');
		expect(match![2]).toBe('');
	});

	it('should match function definitions with parameters', () => {
		const match = '    def init_chapter(number):'.match(funcRegex);
		expect(match).not.toBeNull();
		expect(match![1]).toBe('init_chapter');
		expect(match![2]).toBe('number');
	});

	it('should match function definitions with multiple parameters', () => {
		const match = '    def set_position(character, position=None):'.match(funcRegex);
		expect(match).not.toBeNull();
		expect(match![1]).toBe('set_position');
		expect(match![2]).toBe('character, position=None');
	});
});

describe('Image Pattern Matching', () => {
	const showRegex = /^\s*(show|scene)\s+([a-zA-Z_][a-zA-Z0-9_ ]+?)(?:\s+(?:at|with|as|behind|onlayer|zorder)\b|$)/;

	it('should match simple show statements', () => {
		const match = '    show eileen happy'.match(showRegex);
		expect(match).not.toBeNull();
		expect(match![2].trim()).toBe('eileen happy');
	});

	it('should match show with transition', () => {
		const match = '    show cg kelly_curtains_1 with dissolve'.match(showRegex);
		expect(match).not.toBeNull();
		expect(match![2].trim()).toBe('cg kelly_curtains_1');
	});

	it('should match scene statements', () => {
		const match = '    scene bg apartment_livingroom_morning with fade'.match(showRegex);
		expect(match).not.toBeNull();
		expect(match![2].trim()).toBe('bg apartment_livingroom_morning');
	});

	it('should match scene black', () => {
		const match = '    scene black with fade'.match(showRegex);
		expect(match).not.toBeNull();
		expect(match![2].trim()).toBe('black');
	});
});

describe('Cross-file Diagnostic Re-validation', () => {
	// Simulates the symbol index and validation logic
	type SymbolDef = { kind: string; uri: string };
	const symbolIndex = new Map<string, SymbolDef[]>();

	function addSymbol(name: string, kind: string, uri: string) {
		const existing = symbolIndex.get(name) || [];
		existing.push({ kind, uri });
		symbolIndex.set(name, existing);
	}

	function removeSymbolsFromFile(uri: string) {
		for (const [name, defs] of symbolIndex) {
			const filtered = defs.filter(d => d.uri !== uri);
			if (filtered.length === 0) {
				symbolIndex.delete(name);
			} else {
				symbolIndex.set(name, filtered);
			}
		}
	}

	function isLabelDefined(name: string): boolean {
		const defs = symbolIndex.get(name);
		return !!defs && defs.some(d => d.kind === 'label');
	}

	beforeEach(() => {
		symbolIndex.clear();
	});

	it('should find label after it is added to another file', () => {
		// Initially the label is not defined
		expect(isLabelDefined('chapter_title_card')).toBe(false);

		// Simulate saving a file that defines the label
		addSymbol('chapter_title_card', 'label', 'file:///game/utils.rpy');
		expect(isLabelDefined('chapter_title_card')).toBe(true);
	});

	it('should lose label after its file is re-indexed without it', () => {
		addSymbol('chapter_title_card', 'label', 'file:///game/utils.rpy');
		expect(isLabelDefined('chapter_title_card')).toBe(true);

		// Simulate re-indexing the file after the label was removed
		removeSymbolsFromFile('file:///game/utils.rpy');
		expect(isLabelDefined('chapter_title_card')).toBe(false);
	});

	it('should keep label if defined in multiple files', () => {
		addSymbol('start', 'label', 'file:///game/script.rpy');
		addSymbol('start', 'label', 'file:///game/alt.rpy');

		removeSymbolsFromFile('file:///game/script.rpy');
		expect(isLabelDefined('start')).toBe(true);
	});

	it('should not confuse screen definitions with labels', () => {
		addSymbol('my_screen', 'screen', 'file:///game/screens.rpy');
		expect(isLabelDefined('my_screen')).toBe(false);
	});
});

describe('Quote Matching', () => {
	it('should count quotes correctly', () => {
		const line1 = '"Hello world"';
		const quoteCount1 = (line1.match(/"/g) || []).length;
		expect(quoteCount1).toBe(2);
		expect(quoteCount1 % 2).toBe(0); // Balanced

		const line2 = '"Unmatched quote';
		const quoteCount2 = (line2.match(/"/g) || []).length;
		expect(quoteCount2).toBe(1);
		expect(quoteCount2 % 2).toBe(1); // Unbalanced
	});

	it('should handle escaped quotes', () => {
		const line = '"He said \\"hello\\""';
		const quoteCount = (line.match(/"/g) || []).length;
		const escapedQuotes = (line.match(/\\"/g) || []).length;
		const effectiveQuotes = quoteCount - escapedQuotes;
		expect(effectiveQuotes).toBe(2); // Balanced
		expect(effectiveQuotes % 2).toBe(0);
	});
});
