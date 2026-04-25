// Tests for symbol extraction patterns used in document symbols and go-to-definition

describe('Symbol Extraction Patterns', () => {
	describe('Label Definitions', () => {
		const labelDefRegex = /^(\s*)(label)\s+(\.?[a-zA-Z_][a-zA-Z0-9_.]*)(?:\s*\(([^)]*)\))?\s*:/;

		it('should extract simple label', () => {
			const match = 'label start:'.match(labelDefRegex);
			expect(match).not.toBeNull();
			expect(match![3]).toBe('start');
			expect(match![4]).toBeUndefined(); // no params
		});

		it('should extract label with parameters', () => {
			const match = 'label show_ending(ending_type):'.match(labelDefRegex);
			expect(match).not.toBeNull();
			expect(match![3]).toBe('show_ending');
			expect(match![4]).toBe('ending_type');
		});

		it('should extract local label', () => {
			const match = '    label .choice_a:'.match(labelDefRegex);
			expect(match).not.toBeNull();
			expect(match![3]).toBe('.choice_a');
		});

		it('should extract indented label', () => {
			const match = '        label nested:'.match(labelDefRegex);
			expect(match).not.toBeNull();
			expect(match![1]).toBe('        ');
			expect(match![3]).toBe('nested');
		});
	});

	describe('Label Definitions with init prefix', () => {
		// This is the pattern used in the server for indexing labels
		const labelIndexRegex = /^(\s*)(?:init\s+(?:-?\d+\s+)?)?(label)\s+(\.?[a-zA-Z_][a-zA-Z0-9_.]*)/;

		it('should extract label without init', () => {
			const match = 'label chapter_end:'.match(labelIndexRegex);
			expect(match).not.toBeNull();
			expect(match![3]).toBe('chapter_end');
		});

		it('should extract label with init prefix', () => {
			const match = 'init label chapter_end:'.match(labelIndexRegex);
			expect(match).not.toBeNull();
			expect(match![3]).toBe('chapter_end');
		});

		it('should extract label with init priority', () => {
			const match = 'init -1 label chapter_end:'.match(labelIndexRegex);
			expect(match).not.toBeNull();
			expect(match![3]).toBe('chapter_end');
		});

		it('should extract label with positive init priority', () => {
			const match = 'init 999 label chapter_end:'.match(labelIndexRegex);
			expect(match).not.toBeNull();
			expect(match![3]).toBe('chapter_end');
		});
	});

	describe('Screen Definitions', () => {
		const screenDefRegex = /^(\s*)(screen)\s+([a-zA-Z_][a-zA-Z0-9_]*)(?:\s*\(([^)]*)\))?\s*:/;

		it('should extract simple screen', () => {
			const match = 'screen main_menu:'.match(screenDefRegex);
			expect(match).not.toBeNull();
			expect(match![3]).toBe('main_menu');
		});

		it('should extract screen with parameters', () => {
			const match = 'screen inventory(items, selected=None):'.match(screenDefRegex);
			expect(match).not.toBeNull();
			expect(match![3]).toBe('inventory');
			expect(match![4]).toBe('items, selected=None');
		});
	});

	describe('Screen Definitions with init prefix', () => {
		// This is the pattern used in the server for indexing screens
		const screenIndexRegex = /^(\s*)(?:init\s+(?:-?\d+\s+)?)?(screen)\s+([a-zA-Z_][a-zA-Z0-9_]*)/;

		it('should extract screen without init', () => {
			const match = 'screen phone_message_screen:'.match(screenIndexRegex);
			expect(match).not.toBeNull();
			expect(match![3]).toBe('phone_message_screen');
		});

		it('should extract screen with init prefix', () => {
			const match = 'init screen phone_message_screen:'.match(screenIndexRegex);
			expect(match).not.toBeNull();
			expect(match![3]).toBe('phone_message_screen');
		});

		it('should extract screen with init priority', () => {
			const match = 'init -1 screen phone_message_screen:'.match(screenIndexRegex);
			expect(match).not.toBeNull();
			expect(match![3]).toBe('phone_message_screen');
		});

		it('should extract screen with positive init priority', () => {
			const match = 'init 999 screen phone_message_screen:'.match(screenIndexRegex);
			expect(match).not.toBeNull();
			expect(match![3]).toBe('phone_message_screen');
		});

		it('should extract screen with parameters after init', () => {
			const match = 'init screen my_screen(arg1, arg2):'.match(screenIndexRegex);
			expect(match).not.toBeNull();
			expect(match![3]).toBe('my_screen');
		});
	});

	describe('Transform Definitions', () => {
		const transformDefRegex = /^(\s*)(transform)\s+([a-zA-Z_][a-zA-Z0-9_]*)(?:\s*\(([^)]*)\))?\s*:/;

		it('should extract simple transform', () => {
			const match = 'transform fade_in:'.match(transformDefRegex);
			expect(match).not.toBeNull();
			expect(match![3]).toBe('fade_in');
		});

		it('should extract transform with parameters', () => {
			const match = 'transform slide(duration=0.5):'.match(transformDefRegex);
			expect(match).not.toBeNull();
			expect(match![3]).toBe('slide');
			expect(match![4]).toBe('duration=0.5');
		});
	});

	describe('Image Definitions', () => {
		const imageDefRegex = /^(\s*)(image)\s+([a-zA-Z_][a-zA-Z0-9_ ]+?)\s*(?:=|:)/;

		it('should extract simple image', () => {
			const match = 'image bg room = "backgrounds/room.png"'.match(imageDefRegex);
			expect(match).not.toBeNull();
			expect(match![3].trim()).toBe('bg room');
		});

		it('should extract image with ATL', () => {
			const match = 'image logo animated:'.match(imageDefRegex);
			expect(match).not.toBeNull();
			expect(match![3].trim()).toBe('logo animated');
		});

		it('should extract layeredimage', () => {
			const layeredRegex = /^(\s*)(layeredimage)\s+([a-zA-Z_][a-zA-Z0-9_ ]+?)\s*:/;
			const match = 'layeredimage eileen:'.match(layeredRegex);
			expect(match).not.toBeNull();
			expect(match![3].trim()).toBe('eileen');
		});
	});

	describe('Image Index Variants', () => {
		// Replicates the indexing logic used by the server. For each image
		// definition we index multiple variants for flexible matching, but
		// must NOT index the last attribute alone (e.g. "soft") since common
		// attributes would collide between unrelated characters/chapters.
		function getIndexedNames(fullName: string): string[] {
			const names = [fullName];
			const parts = fullName.split(/\s+/);
			if (parts.length > 1) {
				names.push(parts[0]); // tag
				names.push(parts.slice(1).join(' ')); // rest without tag
				if (parts.length > 2) {
					names.push(parts[0] + ' ' + parts[parts.length - 1]); // tag + last
				}
			}
			return names;
		}

		it('indexes the full name and tag for two-part images', () => {
			const names = getIndexedNames('eileen happy');
			expect(names).toContain('eileen happy');
			expect(names).toContain('eileen');
			expect(names).toContain('happy');
		});

		it('indexes tag, rest, and tag+last for three-part images', () => {
			const names = getIndexedNames('kelly ch01 soft');
			expect(names).toContain('kelly ch01 soft');
			expect(names).toContain('kelly');
			expect(names).toContain('ch01 soft');
			expect(names).toContain('kelly soft');
		});

		it('does NOT index the last attribute alone', () => {
			// Regression: previously "soft" alone was indexed, causing
			// "kelly_casual soft" to wrongly match "kelly ch01 soft"
			const names = getIndexedNames('kelly ch01 soft');
			expect(names).not.toContain('soft');
		});
	});

	describe('Define/Default Statements', () => {
		const defineRegex = /^(\s*)(define|default)\s+([a-zA-Z_][a-zA-Z0-9_.]*)\s*=/;

		it('should extract simple define', () => {
			const match = 'define e = Character("Eileen")'.match(defineRegex);
			expect(match).not.toBeNull();
			expect(match![2]).toBe('define');
			expect(match![3]).toBe('e');
		});

		it('should extract default', () => {
			const match = 'default player_name = "Player"'.match(defineRegex);
			expect(match).not.toBeNull();
			expect(match![2]).toBe('default');
			expect(match![3]).toBe('player_name');
		});

		it('should extract dotted names', () => {
			const match = 'define config.name = "My Game"'.match(defineRegex);
			expect(match).not.toBeNull();
			expect(match![3]).toBe('config.name');
		});
	});

	describe('Style Definitions', () => {
		const styleRegex = /^(\s*)(style)\s+([a-zA-Z_][a-zA-Z0-9_]*)/;

		it('should extract style definition', () => {
			const match = 'style button_text:'.match(styleRegex);
			expect(match).not.toBeNull();
			expect(match![3]).toBe('button_text');
		});

		it('should extract style with inheritance', () => {
			const match = 'style my_button is button:'.match(styleRegex);
			expect(match).not.toBeNull();
			expect(match![3]).toBe('my_button');
		});
	});

	describe('Python Definitions', () => {
		const funcRegex = /^(\s*)def\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(([^)]*)\)/;
		const classRegex = /^(\s*)class\s+([a-zA-Z_][a-zA-Z0-9_]*)/;

		it('should extract function definition', () => {
			const match = '    def calculate_score(player):'.match(funcRegex);
			expect(match).not.toBeNull();
			expect(match![2]).toBe('calculate_score');
			expect(match![3]).toBe('player');
		});

		it('should extract class definition', () => {
			const match = '    class GameState:'.match(classRegex);
			expect(match).not.toBeNull();
			expect(match![2]).toBe('GameState');
		});
	});
});

describe('Symbol Reference Patterns', () => {
	describe('Jump/Call References', () => {
		const jumpCallRegex = /^\s*(jump|call)\s+(?!screen\b)(\.?[a-zA-Z_][a-zA-Z0-9_.]*)/;

		it('should match jump to label', () => {
			const match = '    jump chapter_2'.match(jumpCallRegex);
			expect(match).not.toBeNull();
			expect(match![1]).toBe('jump');
			expect(match![2]).toBe('chapter_2');
		});

		it('should match call to label', () => {
			const match = '    call helper_function'.match(jumpCallRegex);
			expect(match).not.toBeNull();
			expect(match![1]).toBe('call');
			expect(match![2]).toBe('helper_function');
		});

		it('should match local label reference', () => {
			const match = '    jump .choice_bad'.match(jumpCallRegex);
			expect(match).not.toBeNull();
			expect(match![2]).toBe('.choice_bad');
		});

		it('should not match call screen', () => {
			const match = '    call screen save'.match(jumpCallRegex);
			// The negative lookahead should prevent matching "screen"
			expect(match).toBeNull();
		});
	});

	describe('Screen References', () => {
		const useScreenRegex = /^\s*use\s+([a-zA-Z_][a-zA-Z0-9_]*)/;
		const callScreenRegex = /^\s*call\s+screen\s+([a-zA-Z_][a-zA-Z0-9_]*)/;
		const showScreenRegex = /^\s*show\s+screen\s+([a-zA-Z_][a-zA-Z0-9_]*)/;

		it('should match use screen', () => {
			const match = '        use navigation'.match(useScreenRegex);
			expect(match).not.toBeNull();
			expect(match![1]).toBe('navigation');
		});

		it('should match call screen', () => {
			const match = '    call screen confirm'.match(callScreenRegex);
			expect(match).not.toBeNull();
			expect(match![1]).toBe('confirm');
		});

		it('should match show screen', () => {
			const match = '    show screen notify("Hello")'.match(showScreenRegex);
			expect(match).not.toBeNull();
			expect(match![1]).toBe('notify');
		});
	});

	describe('Image References', () => {
		const showImageRegex = /^\s*(show|scene)\s+([a-zA-Z_][a-zA-Z0-9_ ]+?)(?:\s+(?:at|with|as|behind|onlayer|zorder)\b|$)/;

		it('should match show image', () => {
			const match = '    show eileen happy'.match(showImageRegex);
			expect(match).not.toBeNull();
			expect(match![1]).toBe('show');
			expect(match![2].trim()).toBe('eileen happy');
		});

		it('should match scene with transition', () => {
			const match = '    scene bg room with fade'.match(showImageRegex);
			expect(match).not.toBeNull();
			expect(match![1]).toBe('scene');
			expect(match![2].trim()).toBe('bg room');
		});

		it('should match show with position', () => {
			const match = '    show eileen at left'.match(showImageRegex);
			expect(match).not.toBeNull();
			expect(match![2].trim()).toBe('eileen');
		});

		it('should match show cg with transition', () => {
			const match = '    show cg some_image with fade'.match(showImageRegex);
			expect(match).not.toBeNull();
			expect(match![1]).toBe('show');
			expect(match![2].trim()).toBe('cg some_image');
		});

		it('should match multi-part image name', () => {
			const match = '    show cg Kelly_Quickie_05_005 with fade'.match(showImageRegex);
			expect(match).not.toBeNull();
			expect(match![2].trim()).toBe('cg Kelly_Quickie_05_005');
		});
	});

	describe('Show Screen Detection', () => {
		const showScreenCheck = /^\s*show\s+screen\s/;
		const showImageRegex = /^\s*(show|scene)\s+([a-zA-Z_][a-zA-Z0-9_ ]+?)(?:\s+(?:at|with|as|behind|onlayer|zorder)\b|$)/;

		it('should detect show screen and exclude from image check', () => {
			const line = '    show screen phone_message_screen';
			const isShowScreen = showScreenCheck.test(line);
			expect(isShowScreen).toBe(true);
			// When isShowScreen is true, we skip the image regex
		});

		it('should not detect show image as show screen', () => {
			const line = '    show cg some_image with fade';
			const isShowScreen = showScreenCheck.test(line);
			expect(isShowScreen).toBe(false);
			// When isShowScreen is false, we proceed with image regex
			const match = line.match(showImageRegex);
			expect(match).not.toBeNull();
			expect(match![2].trim()).toBe('cg some_image');
		});

		it('should not detect scene as show screen', () => {
			const line = '    scene bg room with fade';
			const isShowScreen = showScreenCheck.test(line);
			expect(isShowScreen).toBe(false);
		});
	});
});
