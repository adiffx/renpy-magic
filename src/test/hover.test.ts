// Tests for hover functionality

import { getDoc, getEntriesByNamespace } from '../server/renpyDocs';

describe('Documentation Lookup', () => {
	describe('Manual Documentation', () => {
		it('should find Character documentation', () => {
			const doc = getDoc('Character');
			expect(doc).toBeDefined();
			expect(doc!.category).toBe('class');
			expect(doc!.signature).toContain('Character');
		});

		it('should find jump statement documentation', () => {
			const doc = getDoc('jump');
			expect(doc).toBeDefined();
			expect(doc!.category).toBe('statement');
		});

		it('should find show statement documentation', () => {
			const doc = getDoc('show');
			expect(doc).toBeDefined();
			expect(doc!.category).toBe('statement');
		});

		it('should find screen statement documentation', () => {
			const doc = getDoc('screen');
			expect(doc).toBeDefined();
			expect(doc!.category).toBe('statement');
		});
	});

	describe('Generated API Documentation', () => {
		it('should find config.name', () => {
			const doc = getDoc('config.name');
			expect(doc).toBeDefined();
			expect(doc!.category).toBe('variable');
		});

		it('should find gui.text_color', () => {
			const doc = getDoc('gui.text_color');
			expect(doc).toBeDefined();
			expect(doc!.category).toBe('variable');
		});

		it('should find gui.show_name', () => {
			const doc = getDoc('gui.show_name');
			expect(doc).toBeDefined();
		});

		it('should find build.name', () => {
			const doc = getDoc('build.name');
			expect(doc).toBeDefined();
		});

		it('should find Jump action', () => {
			const doc = getDoc('Jump');
			expect(doc).toBeDefined();
			expect(doc!.category).toBe('action');
		});

		it('should find style properties', () => {
			const doc = getDoc('background');
			expect(doc).toBeDefined();
			expect(doc!.category).toBe('property');
		});

		it('should find transform properties', () => {
			const doc = getDoc('xpos');
			expect(doc).toBeDefined();
			expect(doc!.category).toBe('property');
		});
	});

	describe('Namespace Queries', () => {
		it('should return config entries', () => {
			const entries = getEntriesByNamespace('config');
			expect(entries.length).toBeGreaterThan(100);
			expect(entries.every(e => e.startsWith('config.'))).toBe(true);
		});

		it('should return gui entries', () => {
			const entries = getEntriesByNamespace('gui');
			expect(entries.length).toBeGreaterThan(50);
			expect(entries.every(e => e.startsWith('gui.'))).toBe(true);
		});

		it('should return build entries', () => {
			const entries = getEntriesByNamespace('build');
			expect(entries.length).toBeGreaterThan(10);
			expect(entries.every(e => e.startsWith('build.'))).toBe(true);
		});

		it('should return empty for unknown namespace', () => {
			const entries = getEntriesByNamespace('unknown');
			expect(entries.length).toBe(0);
		});
	});

	describe('Python Built-in Method Hover', () => {
		it('should extract "format" from ".format(" context', () => {
			// Simulates getWordAtPosition logic for .format(
			const text = '_("Chapter {} Complete").format(_ch)';
			const offset = 28; // cursor on 'f' of format
			let start = offset;
			let end = offset;
			while (start > 0 && /[a-zA-Z0-9_.]/.test(text[start - 1])) start--;
			while (end < text.length && /[a-zA-Z0-9_.]/.test(text[end])) end++;
			let word = text.substring(start, end).replace(/^\.+|\.+$/g, '');
			expect(word).toBe('format');
		});
	});

	describe('Documentation Quality', () => {
		it('config entries should have descriptions', () => {
			const doc = getDoc('config.name');
			expect(doc!.description.length).toBeGreaterThan(10);
		});

		it('action entries should have signatures with parameters', () => {
			const doc = getDoc('Jump');
			expect(doc!.signature).toContain('(');
			expect(doc!.signature).toContain(')');
		});

		it('manual docs should take precedence over generated', () => {
			// Character is in both manual and potentially generated
			const doc = getDoc('Character');
			expect(doc).toBeDefined();
			// Manual docs have more detailed descriptions
			expect(doc!.description).toContain('Parameters');
		});
	});
});
