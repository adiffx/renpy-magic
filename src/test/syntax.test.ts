// Tests for syntax highlighting patterns from renpy.tmLanguage.json

describe('String Tag Pattern', () => {
	const tagRegex = /\{[^}]*\}/g;

	it('should match simple tags', () => {
		const matches = '{b}bold text{/b}'.match(tagRegex);
		expect(matches).toEqual(['{b}', '{/b}']);
	});

	it('should match tags with attributes', () => {
		const matches = '{size=+10}Chapter 5{/size}'.match(tagRegex);
		expect(matches).toEqual(['{size=+10}', '{/size}']);
	});

	it('should match color tags', () => {
		const matches = '{color=#ff0000}red{/color}'.match(tagRegex);
		expect(matches).toEqual(['{color=#ff0000}', '{/color}']);
	});

	it('should match multiple tags in one string', () => {
		const text = '{b}{i}bold italic{/i}{/b}';
		const matches = text.match(tagRegex);
		expect(matches).toEqual(['{b}', '{i}', '{/i}', '{/b}']);
	});

	it('should match self-closing tags', () => {
		const matches = 'line one{n}line two'.match(tagRegex);
		expect(matches).toEqual(['{n}']);
	});
});

describe('String Interpolation Pattern', () => {
	// Simple non-recursive regex for basic interpolation
	const simpleInterpolationRegex = /\[[^\[\]]*\]/g;

	it('should match simple variable interpolation', () => {
		const matches = 'Hello [player_name]!'.match(simpleInterpolationRegex);
		expect(matches).toEqual(['[player_name]']);
	});

	it('should match multiple interpolations', () => {
		const matches = '[greeting] [player_name]!'.match(simpleInterpolationRegex);
		expect(matches).toEqual(['[greeting]', '[player_name]']);
	});

	it('should match expression interpolation', () => {
		const matches = 'Score: [score * 10]'.match(simpleInterpolationRegex);
		expect(matches).toEqual(['[score * 10]']);
	});
});

describe('Nested Interpolation (tmLanguage begin/end)', () => {
	// The tmLanguage uses recursive begin/end for nested brackets.
	// We simulate the nesting detection here.
	function findInterpolationBrackets(text: string): Array<{ start: number; end: number; depth: number }> {
		const brackets: Array<{ start: number; end: number; depth: number }> = [];
		const stack: number[] = [];

		for (let i = 0; i < text.length; i++) {
			if (text[i] === '[') {
				stack.push(i);
			} else if (text[i] === ']' && stack.length > 0) {
				const start = stack.pop()!;
				brackets.push({ start, end: i, depth: stack.length });
			}
		}
		return brackets.sort((a, b) => a.start - b.start);
	}

	it('should handle simple interpolation', () => {
		const brackets = findInterpolationBrackets('[player_name]');
		expect(brackets).toHaveLength(1);
		expect(brackets[0]).toEqual({ start: 0, end: 12, depth: 0 });
	});

	it('should handle nested brackets like [CHAPTER_SUBTITLES[5]]', () => {
		const brackets = findInterpolationBrackets('[CHAPTER_SUBTITLES[5]]');
		expect(brackets).toHaveLength(2);
		// Sorted by start: outer [0..21] comes before inner [18..20]
		expect(brackets[0]).toEqual({ start: 0, end: 21, depth: 0 });
		expect(brackets[1]).toEqual({ start: 18, end: 20, depth: 1 });
	});

	it('should handle complex nested expression', () => {
		const brackets = findInterpolationBrackets('[items[index]]');
		expect(brackets).toHaveLength(2);
		// Sorted by start: outer [0..13] comes before inner [6..12]
		expect(brackets[0]).toEqual({ start: 0, end: 13, depth: 0 });
		expect(brackets[1]).toEqual({ start: 6, end: 12, depth: 1 });
	});

	it('should handle multiple top-level interpolations', () => {
		const brackets = findInterpolationBrackets('[a] and [b]');
		expect(brackets).toHaveLength(2);
		expect(brackets[0].depth).toBe(0);
		expect(brackets[1].depth).toBe(0);
	});
});

describe('Combined Tags and Interpolation in Dialogue', () => {
	const tagRegex = /\{[^}]*\}/g;

	it('should parse centered dialogue with tags and nested interpolation', () => {
		const text = '{size=+10}Chapter [chapter_num]{/size}\\n[CHAPTER_SUBTITLES[5]]';

		// Tags should be found
		const tags = text.match(tagRegex);
		expect(tags).toEqual(['{size=+10}', '{/size}']);

		// Remove tags to see interpolation clearly
		const withoutTags = text.replace(tagRegex, '');
		expect(withoutTags).toBe('Chapter [chapter_num]\\n[CHAPTER_SUBTITLES[5]]');
	});

	it('should handle tags with interpolation inside', () => {
		const text = '{color=[player_color]}Hello{/color}';
		const tags = text.match(tagRegex);
		// The tag regex stops at first }, so it captures {color=[player_color]}
		expect(tags).toEqual(['{color=[player_color]}', '{/color}']);
	});
});

describe('Escaped Bracket [[ in Strings', () => {
	// The tmLanguage matches [[ as an escape before trying interpolation.
	// Simulate: scan left-to-right, [[ is consumed as escape, remaining text is literal.
	const escapedBracketRegex = /\[\[/g;

	function tokenize(text: string): Array<{ type: string; value: string }> {
		const tokens: Array<{ type: string; value: string }> = [];
		let i = 0;
		while (i < text.length) {
			if (text[i] === '[' && text[i + 1] === '[') {
				tokens.push({ type: 'escape', value: '[[' });
				i += 2;
			} else if (text[i] === '[') {
				// Find matching ]
				const start = i;
				let depth = 1;
				i++;
				while (i < text.length && depth > 0) {
					if (text[i] === '[') depth++;
					else if (text[i] === ']') depth--;
					i++;
				}
				tokens.push({ type: 'interpolation', value: text.substring(start, i) });
			} else {
				// Accumulate plain text
				const start = i;
				while (i < text.length && text[i] !== '[') i++;
				tokens.push({ type: 'text', value: text.substring(start, i) });
			}
		}
		return tokens;
	}

	it('should treat [[ as escape, not interpolation', () => {
		// [[Copy] in Ren'Py displays literal [Copy]
		const tokens = tokenize('[[Copy]');
		expect(tokens).toEqual([
			{ type: 'escape', value: '[[' },
			{ type: 'text', value: 'Copy]' }
		]);
	});

	it('should handle [[ escape followed by real interpolation', () => {
		const tokens = tokenize('[[literal] [real_var]');
		expect(tokens).toEqual([
			{ type: 'escape', value: '[[' },
			{ type: 'text', value: 'literal] ' },
			{ type: 'interpolation', value: '[real_var]' }
		]);
	});

	it('should handle the bonus_galleries case', () => {
		// {b}[persistent.player_id]{/b}  {size=-4}[[Copy]{/size}
		const text = '[persistent.player_id]  [[Copy]';
		const tokens = tokenize(text);
		expect(tokens).toEqual([
			{ type: 'interpolation', value: '[persistent.player_id]' },
			{ type: 'text', value: '  ' },
			{ type: 'escape', value: '[[' },
			{ type: 'text', value: 'Copy]' }
		]);
	});

	it('should handle multiple [[ escapes', () => {
		const tokens = tokenize('[[a] and [[b]');
		expect(tokens).toEqual([
			{ type: 'escape', value: '[[' },
			{ type: 'text', value: 'a] and ' },
			{ type: 'escape', value: '[[' },
			{ type: 'text', value: 'b]' }
		]);
	});

	it('should detect [[ with regex', () => {
		const text = '[[Copy]';
		const matches = text.match(escapedBracketRegex);
		expect(matches).toEqual(['[[']);
	});

	it('should not have [[ in normal interpolation', () => {
		const text = '[player_name]';
		const matches = text.match(escapedBracketRegex);
		expect(matches).toBeNull();
	});
});

describe('Escaped Brace {{ in Strings', () => {
	const escapedBraceRegex = /\{\{/g;
	const tagRegex = /\{[^}]*\}/g;

	it('should detect {{ as escape', () => {
		const text = '{{not a tag}';
		const escapes = text.match(escapedBraceRegex);
		expect(escapes).toEqual(['{{']);
	});

	it('should not match {{ as a tag', () => {
		// After consuming {{, the remaining is 'not a tag}' which has no opening {
		// Simulate: remove {{ first, then match tags
		const text = '{{not a tag}';
		const withoutEscapes = text.replace(escapedBraceRegex, '');
		const tags = withoutEscapes.match(tagRegex);
		expect(tags).toBeNull();
	});

	it('should handle {{ alongside real tags', () => {
		const text = '{b}bold{/b} and {{ literal brace';
		const withoutEscapes = text.replace(escapedBraceRegex, '');
		const tags = withoutEscapes.match(tagRegex);
		expect(tags).toEqual(['{b}', '{/b}']);
	});
});

describe('Keyword Highlighting', () => {
	const keywordRegex = /\b(label|menu|if|elif|else|while|for|jump|call|return|pass|screen|transform|image|define|default|init|python|style|layeredimage|show|hide|scene|with|play|stop|queue|pause|nvl|window|frame|text|textbutton|imagebutton|button|vbox|hbox|grid|fixed|side|viewport|use|transclude|on|action|has|at|as|behind|onlayer|zorder|expression|centered|extend)\b/;

	it('should match centered as a keyword', () => {
		expect(keywordRegex.test('centered')).toBe(true);
		expect(keywordRegex.test('    centered "{size=+10}Chapter 5{/size}"')).toBe(true);
	});

	it('should match extend as a keyword', () => {
		expect(keywordRegex.test('extend')).toBe(true);
		expect(keywordRegex.test('    extend " more text"')).toBe(true);
	});

	it('should not match partial keywords', () => {
		expect(keywordRegex.test('centered_text')).toBe(false);
		expect(keywordRegex.test('mycall')).toBe(false);
	});
});

describe('Say Statement Pattern', () => {
	// The begin pattern from the tmLanguage for say statements
	const sayBeginRegex = /^(\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s+(")/;

	it('should match character dialogue', () => {
		const match = '    e "Hello world"'.match(sayBeginRegex);
		expect(match).not.toBeNull();
		expect(match![2]).toBe('e');
	});

	it('should match character with tags in dialogue', () => {
		const match = '    e "{b}Hello{/b} world"'.match(sayBeginRegex);
		expect(match).not.toBeNull();
		expect(match![2]).toBe('e');
	});

	it('should match character with interpolation in dialogue', () => {
		const match = '    narrator "Welcome, [player_name]!"'.match(sayBeginRegex);
		expect(match).not.toBeNull();
		expect(match![2]).toBe('narrator');
	});
});
