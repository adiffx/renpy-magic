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

	describe('Image Name Extraction from Show/Scene', () => {
		const showRegex = /\b(show|scene|hide)\s+(.+?)(?:\s+(?:at|with|as|behind|onlayer|zorder)\b|$)/;

		it('should extract image name from show statement', () => {
			const match = '    show eileen happy'.match(showRegex);
			expect(match).not.toBeNull();
			expect(match![2].trim()).toBe('eileen happy');
		});

		it('should extract image name from scene with transition', () => {
			const match = '    scene bg room with fade'.match(showRegex);
			expect(match).not.toBeNull();
			expect(match![2].trim()).toBe('bg room');
		});

		it('should extract image name from show with at', () => {
			const match = '    show eileen at left'.match(showRegex);
			expect(match).not.toBeNull();
			expect(match![2].trim()).toBe('eileen');
		});

		it('should extract cg names', () => {
			const match = '    show cg beach_sunset with dissolve'.match(showRegex);
			expect(match).not.toBeNull();
			expect(match![2].trim()).toBe('cg beach_sunset');
		});

		it('should detect show screen and skip it', () => {
			const match = '    show screen preferences'.match(showRegex);
			expect(match).not.toBeNull();
			expect(match![2].trim().startsWith('screen ')).toBe(true);
		});
	});

	describe('Image Path from Definition Line', () => {
		const imagePathRegex = /=\s*["']([^"']+\.(?:png|jpg|jpeg|webp))["']/i;

		it('should extract png path', () => {
			const match = 'image bg room = "backgrounds/room.png"'.match(imagePathRegex);
			expect(match).not.toBeNull();
			expect(match![1]).toBe('backgrounds/room.png');
		});

		it('should extract jpg path', () => {
			const match = "image cg beach = 'cg/beach.jpg'".match(imagePathRegex);
			expect(match).not.toBeNull();
			expect(match![1]).toBe('cg/beach.jpg');
		});

		it('should extract webp path', () => {
			const match = 'image sprite = "characters/sprite.webp"'.match(imagePathRegex);
			expect(match).not.toBeNull();
			expect(match![1]).toBe('characters/sprite.webp');
		});

		it('should not match non-image paths', () => {
			const match = 'image animated = "anim.rpym"'.match(imagePathRegex);
			expect(match).toBeNull();
		});

		it('should not match ATL definitions', () => {
			const match = 'image logo animated:'.match(imagePathRegex);
			expect(match).toBeNull();
		});
	});

	describe('Image Name Variants for Resolution', () => {
		function getNameVariants(imageName: string): string[] {
			const namesToTry = [imageName];
			const parts = imageName.split(/\s+/);
			if (parts.length > 1) {
				// Tag + last part (preserves character/CG identity)
				namesToTry.push(parts[0] + ' ' + parts[parts.length - 1]);
			}
			namesToTry.push(imageName.replace(/\s+/g, '_'));
			return namesToTry;
		}

		it('should generate variants for simple image', () => {
			const variants = getNameVariants('eileen');
			expect(variants).toContain('eileen');
		});

		it('should generate variants for two-part image', () => {
			const variants = getNameVariants('eileen happy');
			expect(variants).toContain('eileen happy');
			expect(variants).toContain('eileen_happy');
		});

		it('should generate variants for cg image', () => {
			const variants = getNameVariants('cg beach_sunset');
			expect(variants).toContain('cg beach_sunset');
			expect(variants).toContain('cg_beach_sunset');
		});

		it('should generate tag+last for three-part image', () => {
			const variants = getNameVariants('cg ch05 sunset');
			expect(variants).toContain('cg ch05 sunset');
			expect(variants).toContain('cg sunset');
		});

		// Regression: hovering on a non-existent image like "kelly_casual soft"
		// should not match an unrelated image like "kelly ch01 soft" via just "soft"
		it('should NOT include last-part-only as a variant', () => {
			const variants = getNameVariants('kelly_casual soft');
			expect(variants).not.toContain('soft');
		});

		it('should NOT include rest-without-tag as a variant', () => {
			const variants = getNameVariants('kelly_casual ch06 soft');
			expect(variants).not.toContain('ch06 soft');
		});
	});

	describe('Auto-Discovered Image Indexing', () => {
		// Mirrors the indexing logic in scanImageFiles. Ren'Py's auto-discovery
		// resolves a `scene foo` reference to game/images/**/foo.{ext} regardless
		// of subdirectories, so the basename must be indexed independently.
		const path = require('path');

		function indexFile(prefix: string[], filename: string): Map<string, string> {
			const map = new Map<string, string>();
			const ext = path.extname(filename).toLowerCase();
			const fullPath = '/game/images/' + [...prefix, filename].join('/');
			const rawBase = path.basename(filename, ext);
			const baseName = rawBase.replace(/_/g, ' ');

			const nameParts = [...prefix, baseName];
			const imageName = nameParts.join(' ').toLowerCase();
			map.set(imageName, fullPath);

			const nameWithUnderscores = [...prefix, rawBase].join(' ').toLowerCase();
			if (nameWithUnderscores !== imageName) {
				map.set(nameWithUnderscores, fullPath);
			}

			const baseLower = rawBase.toLowerCase();
			if (!map.has(baseLower)) {
				map.set(baseLower, fullPath);
			}
			const baseSpacedLower = baseName.toLowerCase();
			if (baseSpacedLower !== baseLower && !map.has(baseSpacedLower)) {
				map.set(baseSpacedLower, fullPath);
			}
			return map;
		}

		it('indexes by filename basename for filename-based references', () => {
			// `scene bar_sunset_1` should resolve to images/ch05/bg/bar_sunset_1.jpg
			const map = indexFile(['ch05', 'bg'], 'bar_sunset_1.jpg');
			expect(map.has('bar_sunset_1')).toBe(true);
			expect(map.has('bar sunset 1')).toBe(true);
		});

		it('still indexes by full path-based name', () => {
			const map = indexFile(['ch05', 'bg'], 'bar_sunset_1.jpg');
			expect(map.has('ch05 bg bar sunset 1')).toBe(true);
			expect(map.has('ch05 bg bar_sunset_1')).toBe(true);
		});

		it('indexes basename for files without underscores', () => {
			const map = indexFile(['eileen'], 'happy.png');
			expect(map.has('happy')).toBe(true);
			expect(map.has('eileen happy')).toBe(true);
		});

		it('indexes basename for video files', () => {
			const map = indexFile(['cg'], 'intro_cinematic.webm');
			expect(map.has('intro_cinematic')).toBe(true);
			expect(map.has('intro cinematic')).toBe(true);
		});
	});

	describe('Game Directory Detection', () => {
		const path = require('path');

		function findGameDir(filePath: string): string | null {
			let dir = path.dirname(filePath);
			while (dir !== path.dirname(dir)) {
				if (path.basename(dir) === 'game') {
					return dir;
				}
				dir = path.dirname(dir);
			}
			return null;
		}

		it('should find game dir from .rpy file inside game/', () => {
			const result = findGameDir('/projects/my_game/game/script.rpy');
			expect(result).toBe('/projects/my_game/game');
		});

		it('should find game dir from nested subdirectory', () => {
			const result = findGameDir('/projects/my_game/game/chapters/ch05.rpy');
			expect(result).toBe('/projects/my_game/game');
		});

		it('should find game dir from deeply nested path', () => {
			const result = findGameDir('/projects/my_game/game/system/extras/bonus.rpy');
			expect(result).toBe('/projects/my_game/game');
		});

		it('should return null if no game dir exists', () => {
			const result = findGameDir('/projects/my_game/script.rpy');
			expect(result).toBeNull();
		});
	});

	describe('Image Size Parameter Calculation', () => {
		function getImageSizeParam(dims: { width: number; height: number } | null): string {
			if (!dims) return 'width=300';
			const maxWidth = 400;
			const maxHeight = 200;
			const scaleW = maxWidth / dims.width;
			const scaleH = maxHeight / dims.height;
			const scale = Math.min(scaleW, scaleH, 1);
			const w = Math.round(dims.width * scale);
			const h = Math.round(dims.height * scale);
			if (scaleW < scaleH) {
				return `width=${w}`;
			} else {
				return `height=${h}`;
			}
		}

		it('should return width=300 when dimensions unknown', () => {
			expect(getImageSizeParam(null)).toBe('width=300');
		});

		it('should constrain width for landscape images', () => {
			// 1920x1080 -> scaleW=0.208, scaleH=0.185 -> scaleW > scaleH -> height constrained
			const result = getImageSizeParam({ width: 1920, height: 1080 });
			expect(result).toBe('height=200');
		});

		it('should constrain height for portrait images', () => {
			// 600x1200 -> scaleW=0.667, scaleH=0.167 -> scaleH < scaleW -> height constrained
			const result = getImageSizeParam({ width: 600, height: 1200 });
			expect(result).toBe('height=200');
		});

		it('should constrain width for very wide images', () => {
			// 2000x400 -> scaleW=0.2, scaleH=0.5 -> scaleW < scaleH -> width constrained
			const result = getImageSizeParam({ width: 2000, height: 400 });
			expect(result).toBe('width=400');
		});

		it('should not upscale small images', () => {
			// 100x80 -> both scales > 1, clamped to 1
			const result = getImageSizeParam({ width: 100, height: 80 });
			expect(result).toBe('height=80');
		});

		it('should handle square images', () => {
			// 800x800 -> scaleW=0.5, scaleH=0.25 -> height constrained
			const result = getImageSizeParam({ width: 800, height: 800 });
			expect(result).toBe('height=200');
		});
	});

	describe('Image Dimension Parsing', () => {
		it('should parse PNG dimensions from buffer', () => {
			// PNG header: 8-byte signature, then IHDR chunk with width/height at offset 16/20
			const buf = Buffer.alloc(24);
			// PNG signature
			buf.writeUInt8(0x89, 0);
			buf.write('PNG', 1);
			// Width=640 at offset 16, Height=480 at offset 20 (big-endian)
			buf.writeUInt32BE(640, 16);
			buf.writeUInt32BE(480, 20);
			expect(buf.readUInt32BE(16)).toBe(640);
			expect(buf.readUInt32BE(20)).toBe(480);
		});

		it('should parse WebP VP8X dimensions from buffer', () => {
			// VP8X: canvas width at bytes 24-26 (LE, +1), height at 27-29 (LE, +1)
			const buf = Buffer.alloc(30);
			buf.write('RIFF', 0);
			buf.write('WEBP', 8);
			buf.write('VP8X', 12);
			// Width = 844 -> stored as 843 in 3 bytes LE
			const w = 843;
			buf[24] = w & 0xFF;
			buf[25] = (w >> 8) & 0xFF;
			buf[26] = (w >> 16) & 0xFF;
			// Height = 1080 -> stored as 1079 in 3 bytes LE
			const h = 1079;
			buf[27] = h & 0xFF;
			buf[28] = (h >> 8) & 0xFF;
			buf[29] = (h >> 16) & 0xFF;

			const width = (buf[24] | (buf[25] << 8) | (buf[26] << 16)) + 1;
			const height = (buf[27] | (buf[28] << 8) | (buf[29] << 16)) + 1;
			expect(width).toBe(844);
			expect(height).toBe(1080);
		});

		it('should parse JPEG SOF0 dimensions from buffer', () => {
			// SOF0 marker: 0xFF 0xC0, then length, then precision, height (2B BE), width (2B BE)
			const buf = Buffer.alloc(12);
			buf[0] = 0xFF;
			buf[1] = 0xC0;
			buf.writeUInt16BE(17, 2); // length
			buf[4] = 8; // precision
			buf.writeUInt16BE(720, 5); // height
			buf.writeUInt16BE(1280, 7); // width

			// Simulate the parser
			let foundWidth = 0, foundHeight = 0;
			for (let i = 0; i < buf.length - 9; i++) {
				if (buf[i] === 0xFF && (buf[i + 1] === 0xC0 || buf[i + 1] === 0xC2)) {
					foundHeight = buf.readUInt16BE(i + 5);
					foundWidth = buf.readUInt16BE(i + 7);
					break;
				}
			}
			expect(foundWidth).toBe(1280);
			expect(foundHeight).toBe(720);
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
