import { extractAssetPath, AUDIO_EXTENSIONS, IMAGE_EXTENSIONS } from '../server/assetPath';

describe('extractAssetPath', () => {
	describe('image extensions', () => {
		it('extracts a bare quoted path', () => {
			const lines = ['image foo = "images/foo.png"'];
			expect(extractAssetPath(lines, 0, IMAGE_EXTENSIONS)).toBe('images/foo.png');
		});

		it('extracts from a Transform(...) wrapper', () => {
			const lines = ['image foo = Transform("images/foo.webp", zoom=0.9)'];
			expect(extractAssetPath(lines, 0, IMAGE_EXTENSIONS)).toBe('images/foo.webp');
		});

		it('extracts from a multi-line ConditionSwitch', () => {
			const lines = [
				'image cg ch06 Kelly = ConditionSwitch(',
				'    "cond_a", "images/a.jpg",',
				'    "cond_b", "images/b.jpg",',
				')',
			];
			expect(extractAssetPath(lines, 0, IMAGE_EXTENSIONS)).toBe('images/a.jpg');
		});

		it('does not scan past the matching close paren', () => {
			const lines = [
				'image foo = Something(',
				'    a, b, c,',
				')',
				'image bar = "images/bar.png"',
			];
			expect(extractAssetPath(lines, 0, IMAGE_EXTENSIONS)).toBeNull();
		});
	});

	describe('audio extensions', () => {
		it('extracts a bare ogg path', () => {
			const lines = ['define audio.comedic_awkward = "assets/audio/bgm/comedic_awkward.ogg"'];
			expect(extractAssetPath(lines, 0, AUDIO_EXTENSIONS)).toBe('assets/audio/bgm/comedic_awkward.ogg');
		});

		it('extracts mp3, wav, opus, flac, m4a', () => {
			for (const ext of ['mp3', 'wav', 'opus', 'flac', 'm4a']) {
				const lines = [`define audio.x = "audio/file.${ext}"`];
				expect(extractAssetPath(lines, 0, AUDIO_EXTENSIONS)).toBe(`audio/file.${ext}`);
			}
		});

		it('does not match image extensions when scanning for audio', () => {
			const lines = ['define x = "assets/cover.png"'];
			expect(extractAssetPath(lines, 0, AUDIO_EXTENSIONS)).toBeNull();
		});
	});

	describe('edge cases', () => {
		it('returns null when there is no equals sign', () => {
			const lines = ['label start:'];
			expect(extractAssetPath(lines, 0, IMAGE_EXTENSIONS)).toBeNull();
		});

		it('returns null for an out-of-range start line', () => {
			expect(extractAssetPath(['image foo = "x.png"'], 5, IMAGE_EXTENSIONS)).toBeNull();
		});

		it('returns null when the quoted string is not an asset', () => {
			const lines = ['image x = SomeWidget("hello world")'];
			expect(extractAssetPath(lines, 0, IMAGE_EXTENSIONS)).toBeNull();
		});

		it('respects the maxLookahead bound', () => {
			// Open paren but no path within bound
			const lines = ['image foo = Something('];
			for (let i = 0; i < 60; i++) lines.push('    a,');
			lines.push('    "images/late.png",');
			lines.push(')');
			expect(extractAssetPath(lines, 0, IMAGE_EXTENSIONS, 5)).toBeNull();
			// With a generous bound, it finds the path
			expect(extractAssetPath(lines, 0, IMAGE_EXTENSIONS, 100)).toBe('images/late.png');
		});
	});
});
