// Tests for Ren'Py lint output parsing

describe('Ren\'Py Lint Output Parsing', () => {
	// Replicate the parseLintOutput function for testing
	interface LintError {
		file: string;
		line: number;
		message: string;
		severity: 'error' | 'warning';
	}

	function parseLintOutput(output: string): LintError[] {
		const errors: LintError[] = [];
		const lines = output.split('\n');

		// Pattern 1: File "path", line N: message
		const fileLinePattern = /File "([^"]+)", line (\d+)(?::\d+)?[,:]\s*(.+)/;
		// Pattern 2: path:line message (used for some warnings)
		const pathLinePattern = /^([^:]+\.rpy[mc]?):(\d+)\s+(.+)/;
		// Pattern 3: path:line: message
		const pathLineColonPattern = /^([^:]+\.rpy[mc]?):(\d+):\s*(.+)/;

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i].trim();
			if (!line) continue;

			let match = line.match(fileLinePattern);
			if (match) {
				const filePath = match[1];
				const lineNum = parseInt(match[2], 10);
				let message = match[3].trim();

				// Check for continuation on next line
				if (i + 1 < lines.length && !lines[i + 1].match(/^(File |[a-zA-Z]:|\/)/)) {
					const nextLine = lines[i + 1].trim();
					if (nextLine && !nextLine.startsWith('^')) {
						message += ' ' + nextLine;
					}
				}

				errors.push({
					file: filePath,
					line: lineNum,
					message,
					severity: message.toLowerCase().includes('error') ? 'error' : 'warning'
				});
				continue;
			}

			match = line.match(pathLineColonPattern);
			if (match) {
				errors.push({
					file: match[1],
					line: parseInt(match[2], 10),
					message: match[3].trim(),
					severity: 'warning'
				});
				continue;
			}

			match = line.match(pathLinePattern);
			if (match) {
				errors.push({
					file: match[1],
					line: parseInt(match[2], 10),
					message: match[3].trim(),
					severity: 'warning'
				});
			}
		}

		return errors;
	}

	describe('File "path", line N: format', () => {
		it('should parse standard Python-style error', () => {
			const output = 'File "game/script.rpy", line 15: end of line expected.';
			const errors = parseLintOutput(output);
			expect(errors).toHaveLength(1);
			expect(errors[0].file).toBe('game/script.rpy');
			expect(errors[0].line).toBe(15);
			expect(errors[0].message).toBe('end of line expected.');
		});

		it('should parse error with column', () => {
			const output = 'File "game/screens.rpy", line 42:10: unexpected token';
			const errors = parseLintOutput(output);
			expect(errors).toHaveLength(1);
			expect(errors[0].file).toBe('game/screens.rpy');
			expect(errors[0].line).toBe(42);
			expect(errors[0].message).toBe('unexpected token');
		});

		it('should detect error severity from message', () => {
			const output = 'File "game/script.rpy", line 5: SyntaxError: invalid syntax';
			const errors = parseLintOutput(output);
			expect(errors).toHaveLength(1);
			expect(errors[0].severity).toBe('error');
		});

		it('should parse multiline error', () => {
			const output = `File "game/script.rpy", line 100: undefined name
    'nonexistent' is not defined`;
			const errors = parseLintOutput(output);
			expect(errors).toHaveLength(1);
			expect(errors[0].message).toContain('undefined name');
			expect(errors[0].message).toContain("'nonexistent'");
		});
	});

	describe('path:line message format', () => {
		it('should parse simple path:line warning', () => {
			const output = 'game/definitions.rpy:333 \'define fade\' replaces a Ren\'Py built-in name';
			const errors = parseLintOutput(output);
			expect(errors).toHaveLength(1);
			expect(errors[0].file).toBe('game/definitions.rpy');
			expect(errors[0].line).toBe(333);
			expect(errors[0].message).toBe("'define fade' replaces a Ren'Py built-in name");
			expect(errors[0].severity).toBe('warning');
		});

		it('should parse path:line: message format', () => {
			const output = 'game/screens.rpy:100: missing return statement';
			const errors = parseLintOutput(output);
			expect(errors).toHaveLength(1);
			expect(errors[0].file).toBe('game/screens.rpy');
			expect(errors[0].line).toBe(100);
			expect(errors[0].message).toBe('missing return statement');
		});
	});

	describe('Multiple errors', () => {
		it('should parse multiple errors from different files', () => {
			const output = `File "game/script.rpy", line 10: undefined label 'missing'
game/screens.rpy:50 Screen 'inventory' is not defined
File "game/chapter1.rpy", line 200: parse error`;

			const errors = parseLintOutput(output);
			expect(errors).toHaveLength(3);
			expect(errors[0].file).toBe('game/script.rpy');
			expect(errors[1].file).toBe('game/screens.rpy');
			expect(errors[2].file).toBe('game/chapter1.rpy');
		});

		it('should handle empty lines between errors', () => {
			const output = `File "game/a.rpy", line 1: error 1

File "game/b.rpy", line 2: error 2

`;
			const errors = parseLintOutput(output);
			expect(errors).toHaveLength(2);
		});
	});

	describe('Edge cases', () => {
		it('should handle .rpym files', () => {
			const output = 'game/init.rpym:10 warning message';
			const errors = parseLintOutput(output);
			expect(errors).toHaveLength(1);
			expect(errors[0].file).toBe('game/init.rpym');
		});

		it('should handle .rpyc files', () => {
			const output = 'game/script.rpyc:20 compiled file warning';
			const errors = parseLintOutput(output);
			expect(errors).toHaveLength(1);
			expect(errors[0].file).toBe('game/script.rpyc');
		});

		it('should handle absolute paths', () => {
			const output = 'File "/Users/dev/project/game/script.rpy", line 5: error';
			const errors = parseLintOutput(output);
			expect(errors).toHaveLength(1);
			expect(errors[0].file).toBe('/Users/dev/project/game/script.rpy');
		});

		it('should handle Windows paths', () => {
			const output = 'File "C:\\Users\\dev\\project\\game\\script.rpy", line 5: error';
			const errors = parseLintOutput(output);
			expect(errors).toHaveLength(1);
			expect(errors[0].file).toBe('C:\\Users\\dev\\project\\game\\script.rpy');
		});

		it('should return empty array for non-error output', () => {
			const output = `Running lint...
Project loaded successfully.
No errors found.`;
			const errors = parseLintOutput(output);
			expect(errors).toHaveLength(0);
		});

		it('should skip caret lines', () => {
			const output = `File "game/script.rpy", line 10: syntax error
    show eileen happy
    ^^^^`;
			const errors = parseLintOutput(output);
			expect(errors).toHaveLength(1);
			expect(errors[0].message).not.toContain('^^^^');
		});
	});
});

describe('Project Root Detection', () => {
	const path = require('path');

	function findProjectRoot(filePath: string): string | null {
		// Mock implementation for testing
		const parts = filePath.split(path.sep);
		for (let i = parts.length - 1; i >= 0; i--) {
			if (parts[i] === 'game') {
				return parts.slice(0, i).join(path.sep);
			}
		}
		return null;
	}

	it('should find project root from file in game folder', () => {
		const result = findProjectRoot('/projects/my_game/game/script.rpy');
		expect(result).toBe('/projects/my_game');
	});

	it('should find project root from nested game subfolder', () => {
		const result = findProjectRoot('/projects/my_game/game/chapters/ch1.rpy');
		expect(result).toBe('/projects/my_game');
	});

	it('should return null if no game folder exists', () => {
		const result = findProjectRoot('/projects/other/script.rpy');
		expect(result).toBeNull();
	});
});

describe('Lint Error Severity Detection', () => {
	function getSeverity(message: string): 'error' | 'warning' {
		return message.toLowerCase().includes('error') ? 'error' : 'warning';
	}

	it('should detect error from message', () => {
		expect(getSeverity('SyntaxError: invalid syntax')).toBe('error');
		expect(getSeverity('ParseError: unexpected token')).toBe('error');
		expect(getSeverity('IndentationError: unexpected indent')).toBe('error');
	});

	it('should default to warning', () => {
		expect(getSeverity('undefined label')).toBe('warning');
		expect(getSeverity('missing screen')).toBe('warning');
		expect(getSeverity("'define fade' replaces built-in")).toBe('warning');
	});
});
