// Tests for completion functionality

// Simulate getWordAtPosition logic
function getWordAtPosition(text: string, offset: number): string {
	let start = offset;
	let end = offset;

	// Go backwards to find start (include dots)
	while (start > 0 && /[a-zA-Z0-9_.]/.test(text[start - 1])) {
		start--;
	}

	// Go forwards to find end (include dots)
	while (end < text.length && /[a-zA-Z0-9_.]/.test(text[end])) {
		end++;
	}

	// Clean up: remove leading/trailing dots
	let word = text.substring(start, end);
	word = word.replace(/^\.+|\.+$/g, '');

	return word;
}

// Simulate namespace completion matching
function getNamespaceMatch(lineContext: string): { namespace: string; partial: string } | null {
	const match = lineContext.match(/\b([a-zA-Z_][a-zA-Z0-9_]*)\.(\w*)$/);
	if (match) {
		return { namespace: match[1], partial: match[2] };
	}
	return null;
}

// Simulate completion suppression check
function shouldSuppressCompletions(lineContext: string): boolean {
	// Suppress after complete namespace.member followed by space/=
	return /\b[a-zA-Z_][a-zA-Z0-9_]*\.[a-zA-Z_][a-zA-Z0-9_]+[\s=]+$/.test(lineContext);
}

describe('Word at Position (for Hover)', () => {
	it('should extract simple words', () => {
		const text = 'define character = Character("Name")';
		expect(getWordAtPosition(text, 7)).toBe('character'); // cursor on 'character'
		expect(getWordAtPosition(text, 22)).toBe('Character'); // cursor on 'Character'
	});

	it('should extract dotted names like config.name', () => {
		const text = 'define config.name = "My Game"';
		expect(getWordAtPosition(text, 7)).toBe('config.name'); // cursor on 'config'
		expect(getWordAtPosition(text, 14)).toBe('config.name'); // cursor on 'name'
	});

	it('should extract gui.xxx variables', () => {
		const text = 'define gui.text_color = "#ffffff"';
		expect(getWordAtPosition(text, 7)).toBe('gui.text_color'); // cursor on 'gui'
		expect(getWordAtPosition(text, 11)).toBe('gui.text_color'); // cursor on 'text_color'
	});

	it('should extract build.xxx variables', () => {
		const text = 'define build.name = "game"';
		expect(getWordAtPosition(text, 7)).toBe('build.name');
		expect(getWordAtPosition(text, 13)).toBe('build.name');
	});

	it('should handle multiple dots', () => {
		const text = 'renpy.config.screen_width';
		expect(getWordAtPosition(text, 0)).toBe('renpy.config.screen_width');
		expect(getWordAtPosition(text, 10)).toBe('renpy.config.screen_width');
	});

	it('should not include surrounding punctuation', () => {
		const text = '(config.name)';
		expect(getWordAtPosition(text, 1)).toBe('config.name');
		expect(getWordAtPosition(text, 8)).toBe('config.name');
	});

	it('should handle word at start of line', () => {
		const text = 'config.name = "Test"';
		expect(getWordAtPosition(text, 0)).toBe('config.name');
	});

	it('should handle word at end of line', () => {
		const text = 'x = config.name';
		expect(getWordAtPosition(text, 14)).toBe('config.name');
	});
});

describe('Namespace Completion Matching', () => {
	it('should match config. at end of line', () => {
		const result = getNamespaceMatch('define config.');
		expect(result).not.toBeNull();
		expect(result!.namespace).toBe('config');
		expect(result!.partial).toBe('');
	});

	it('should match config.na partial', () => {
		const result = getNamespaceMatch('define config.na');
		expect(result).not.toBeNull();
		expect(result!.namespace).toBe('config');
		expect(result!.partial).toBe('na');
	});

	it('should match gui. namespace', () => {
		const result = getNamespaceMatch('define gui.');
		expect(result).not.toBeNull();
		expect(result!.namespace).toBe('gui');
		expect(result!.partial).toBe('');
	});

	it('should match gui.text partial', () => {
		const result = getNamespaceMatch('define gui.text');
		expect(result).not.toBeNull();
		expect(result!.namespace).toBe('gui');
		expect(result!.partial).toBe('text');
	});

	it('should match build. namespace', () => {
		const result = getNamespaceMatch('define build.');
		expect(result).not.toBeNull();
		expect(result!.namespace).toBe('build');
	});

	it('should match renpy. namespace', () => {
		const result = getNamespaceMatch('$ renpy.');
		expect(result).not.toBeNull();
		expect(result!.namespace).toBe('renpy');
	});

	it('should not match when no dot present', () => {
		const result = getNamespaceMatch('define config');
		expect(result).toBeNull();
	});

	it('should not match standalone dot', () => {
		const result = getNamespaceMatch('define .');
		expect(result).toBeNull();
	});

	it('should match custom namespaces', () => {
		const result = getNamespaceMatch('mymodule.');
		expect(result).not.toBeNull();
		expect(result!.namespace).toBe('mymodule');
	});
});

describe('Completion Suppression', () => {
	it('should suppress after config.name followed by space', () => {
		expect(shouldSuppressCompletions('define config.name ')).toBe(true);
	});

	it('should suppress after gui.text_color followed by space', () => {
		expect(shouldSuppressCompletions('define gui.text_color ')).toBe(true);
	});

	it('should suppress after config.name followed by =', () => {
		expect(shouldSuppressCompletions('define config.name =')).toBe(true);
	});

	it('should suppress after config.name followed by space and =', () => {
		expect(shouldSuppressCompletions('define config.name = ')).toBe(true);
	});

	it('should suppress after multiple spaces', () => {
		expect(shouldSuppressCompletions('define config.name   ')).toBe(true);
	});

	it('should NOT suppress while still typing variable name', () => {
		expect(shouldSuppressCompletions('define config.na')).toBe(false);
	});

	it('should NOT suppress with just namespace dot', () => {
		expect(shouldSuppressCompletions('define config.')).toBe(false);
	});

	it('should NOT suppress for regular words', () => {
		expect(shouldSuppressCompletions('define myvar ')).toBe(false);
	});

	it('should suppress for any namespace pattern', () => {
		expect(shouldSuppressCompletions('x = build.name ')).toBe(true);
		expect(shouldSuppressCompletions('$ renpy.pause ')).toBe(true);
	});
});

describe('Space-triggered Completion Filtering', () => {
	// When space is the trigger character, only show completions for jump/call
	const shouldShowOnSpace = (lineContext: string): boolean => {
		return /\b(jump|call)\s+$/.test(lineContext);
	};

	it('should show completions after "jump "', () => {
		expect(shouldShowOnSpace('jump ')).toBe(true);
		expect(shouldShowOnSpace('    jump ')).toBe(true);
	});

	it('should show completions after "call "', () => {
		expect(shouldShowOnSpace('call ')).toBe(true);
		expect(shouldShowOnSpace('    call ')).toBe(true);
	});

	it('should NOT show completions for leading whitespace', () => {
		expect(shouldShowOnSpace('    ')).toBe(false);
		expect(shouldShowOnSpace('        ')).toBe(false);
	});

	it('should NOT show completions after arbitrary words', () => {
		expect(shouldShowOnSpace('show ')).toBe(false);
		expect(shouldShowOnSpace('define ')).toBe(false);
		expect(shouldShowOnSpace('label ')).toBe(false);
		expect(shouldShowOnSpace('scene bg room ')).toBe(false);
	});
});

describe('String Completion Suppression', () => {
	function isInsideString(lineContext: string): boolean {
		const doubleQuotes = (lineContext.match(/"/g) || []).length;
		const singleQuotes = (lineContext.match(/'/g) || []).length;
		return doubleQuotes % 2 === 1 || singleQuotes % 2 === 1;
	}

	it('should detect inside double-quoted string', () => {
		expect(isInsideString('"hello ')).toBe(true);
		expect(isInsideString('define x = "some text')).toBe(true);
	});

	it('should detect inside single-quoted string', () => {
		expect(isInsideString("'hello ")).toBe(true);
		expect(isInsideString("define x = 'some text")).toBe(true);
	});

	it('should NOT suppress outside strings', () => {
		expect(isInsideString('define x = ')).toBe(false);
		expect(isInsideString('"complete" ')).toBe(false);
		expect(isInsideString("'complete' ")).toBe(false);
	});
});

describe('Style Prefix Completion Context', () => {
	const stylePrefixRegex = /\bstyle_prefix\s+["']?\w*$/;

	it('should match style_prefix with space', () => {
		expect(stylePrefixRegex.test('style_prefix ')).toBe(true);
	});

	it('should match style_prefix with partial value', () => {
		expect(stylePrefixRegex.test('style_prefix "cho')).toBe(true);
		expect(stylePrefixRegex.test("style_prefix 'inp")).toBe(true);
	});

	it('should match style_prefix without quotes', () => {
		expect(stylePrefixRegex.test('style_prefix nav')).toBe(true);
	});

	it('should not match mid-line style_prefix', () => {
		expect(stylePrefixRegex.test('style_prefix "choice" # comment')).toBe(false);
	});
});

describe('Transition Completion Context', () => {
	const withRegex = /\bwith\s+\w*$/;

	it('should match "with " for transition completions', () => {
		expect(withRegex.test('show eileen happy with ')).toBe(true);
		expect(withRegex.test('scene bg room with ')).toBe(true);
	});

	it('should match partial transition name', () => {
		expect(withRegex.test('show eileen with dis')).toBe(true);
		expect(withRegex.test('scene bg with fa')).toBe(true);
	});

	it('should not match completed transition', () => {
		expect(withRegex.test('show eileen with dissolve ')).toBe(false);
	});
});

describe('Action Completion Context', () => {
	const actionRegex = /\baction\s+\w*$/;

	it('should match "action " for action completions', () => {
		expect(actionRegex.test('textbutton "Click" action ')).toBe(true);
	});

	it('should match partial action name', () => {
		expect(actionRegex.test('textbutton "Click" action Jum')).toBe(true);
		expect(actionRegex.test('button: action Set')).toBe(true);
	});
});

describe('Jump/Call Label Completion Context', () => {
	const jumpRegex = /\b(jump|call)\s+(?!screen\b)([a-zA-Z_]\w*)?$/;

	it('should match jump with partial label', () => {
		expect(jumpRegex.test('jump chap')).toBe(true);
		expect(jumpRegex.test('    jump start')).toBe(true);
	});

	it('should match call with partial label', () => {
		expect(jumpRegex.test('call help')).toBe(true);
	});

	it('should match jump/call with no label yet', () => {
		expect(jumpRegex.test('jump ')).toBe(true);
		expect(jumpRegex.test('call ')).toBe(true);
	});

	it('should NOT match call screen', () => {
		// This regex uses negative lookahead for "screen"
		expect(jumpRegex.test('call screen')).toBe(false);
	});
});

describe('Screen Completion Context', () => {
	const screenUseRegex = /\buse\s+([a-zA-Z_]\w*)?$/;
	const callScreenRegex = /\bcall\s+screen\s+([a-zA-Z_]\w*)?$/;
	const showScreenRegex = /\bshow\s+screen\s+([a-zA-Z_]\w*)?$/;

	it('should match "use " for screen completions', () => {
		expect(screenUseRegex.test('use ')).toBe(true);
		expect(screenUseRegex.test('use nav')).toBe(true);
	});

	it('should match "call screen " for screen completions', () => {
		expect(callScreenRegex.test('call screen ')).toBe(true);
		expect(callScreenRegex.test('call screen sa')).toBe(true);
	});

	it('should match "show screen " for screen completions', () => {
		expect(showScreenRegex.test('show screen ')).toBe(true);
		expect(showScreenRegex.test('show screen pref')).toBe(true);
	});
});

describe('Signature Help - Function Name Extraction', () => {
	// This is the regex used in the signature help handler
	const sigRegex = /([a-zA-Z_][a-zA-Z0-9_.]*)\s*\([^)]*$/;

	it('should extract format from .format(', () => {
		const match = '_("Chapter {} Complete").format('.match(sigRegex);
		expect(match).not.toBeNull();
		expect(match![1]).toBe('format');
	});

	it('should extract format with args already typed', () => {
		const match = '_("Chapter {} Complete").format(_ch'.match(sigRegex);
		expect(match).not.toBeNull();
		expect(match![1]).toBe('format');
	});

	it('should extract simple function name', () => {
		const match = 'Character("Eileen"'.match(sigRegex);
		expect(match).not.toBeNull();
		expect(match![1]).toBe('Character');
	});

	it('should extract namespaced function', () => {
		const match = 'renpy.pause('.match(sigRegex);
		expect(match).not.toBeNull();
		expect(match![1]).toBe('renpy.pause');
	});

	it('should extract function with multiple args', () => {
		const match = 'Dissolve(0.5, alpha=True'.match(sigRegex);
		expect(match).not.toBeNull();
		expect(match![1]).toBe('Dissolve');
	});

	it('should not match when parens are closed', () => {
		const match = 'format()'.match(sigRegex);
		expect(match).toBeNull();
	});
});
