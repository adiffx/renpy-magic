import {
	createConnection,
	TextDocuments,
	ProposedFeatures,
	InitializeParams,
	InitializeResult,
	TextDocumentSyncKind,
	CompletionItem,
	CompletionItemKind,
	Hover,
	MarkupKind,
	TextDocumentPositionParams,
	DocumentSymbol,
	DocumentSymbolParams,
	SymbolKind,
	Range,
	Position,
	Definition,
	DefinitionParams,
	Location,
	WorkspaceFolder,
	SignatureHelp,
	SignatureHelpParams,
	SignatureInformation,
	ParameterInformation,
	WorkspaceSymbolParams,
	SymbolInformation,
	ReferenceParams,
	Diagnostic,
	DiagnosticSeverity,
	RenameParams,
	WorkspaceEdit,
	TextEdit,
	PrepareRenameParams,
	FileChangeType,
	DidChangeWatchedFilesParams,
} from 'vscode-languageserver/node';

import { TextDocument } from 'vscode-languageserver-textdocument';
import { renpyDocs, getAllSymbols, getDoc, DocEntry, getEntriesByNamespace } from './renpyDocs';
import { dottedSegmentAt } from './symbolLookup';
import * as fs from 'fs';
import * as path from 'path';
import { URI } from 'vscode-uri';
import { execFile } from 'child_process';

// Create a connection for the server
const connection = createConnection(ProposedFeatures.all);

// Create a text document manager
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

// Workspace folders
let workspaceFolders: WorkspaceFolder[] = [];

// Settings
interface Settings {
	diagnostics: {
		warnUndefinedImages: boolean;
	};
	renpySdkPath: string;
	lint: {
		enabled: boolean;
		onSave: boolean;
	};
}

const defaultSettings: Settings = {
	diagnostics: {
		warnUndefinedImages: false
	},
	renpySdkPath: '',
	lint: {
		enabled: false,
		onSave: true
	}
};

let globalSettings: Settings = defaultSettings;

// Lint state
let lintDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let lintIsRunning = false;
let lintPendingAfterCurrent = false;
const lintDiagnostics: Map<string, Diagnostic[]> = new Map(); // URI -> lint diagnostics

// Symbol index for go-to-definition
interface SymbolDefinition {
	name: string;
	kind: 'label' | 'screen' | 'transform' | 'image' | 'define' | 'default' | 'style' | 'layeredimage' | 'python_function' | 'python_class';
	uri: string;
	line: number;
	character: number;
	parameters?: string; // For functions: the parameter list
	imagePath?: string; // For images: resolved file path
}

const symbolIndex: Map<string, SymbolDefinition[]> = new Map();

// Map of image names to their file paths (from images/ folder auto-discovery)
const imageFilePaths: Map<string, string> = new Map();

// User-defined function signatures (populated during indexing)
const userFunctionSignatures: Map<string, SignatureData> = new Map();

// Ren'Py keywords for completion
const renpyKeywords = [
	'label', 'menu', 'if', 'elif', 'else', 'while', 'for',
	'jump', 'call', 'return', 'pass', 'screen', 'transform',
	'image', 'define', 'default', 'init', 'python', 'style',
	'layeredimage', 'show', 'hide', 'scene', 'with', 'play',
	'stop', 'queue', 'pause', 'nvl', 'window', 'frame', 'text',
	'textbutton', 'imagebutton', 'button', 'vbox', 'hbox',
	'grid', 'fixed', 'side', 'viewport', 'use', 'transclude',
	'on', 'action', 'has', 'at', 'as', 'behind', 'onlayer',
	'zorder', 'expression', 'add', 'input', 'key', 'timer',
	'contains', 'parallel', 'block', 'choice', 'repeat'
];

// ATL keywords
const atlKeywords = [
	'linear', 'ease', 'easein', 'easeout', 'time', 'pause',
	'repeat', 'block', 'parallel', 'choice', 'contains',
	'function', 'event', 'on', 'animation', 'warp',
	'clockwise', 'counterclockwise', 'circles', 'knot'
];

// Pre-defined transitions (lowercase, used with "with")
const builtinTransitions = [
	'dissolve', 'fade', 'pixellate', 'move', 'moveinright', 'moveinleft',
	'moveintop', 'moveinbottom', 'moveoutright', 'moveoutleft', 'moveouttop',
	'moveoutbottom', 'ease', 'easeinright', 'easeinleft', 'easeintop',
	'easeinbottom', 'easeoutright', 'easeoutleft', 'easeouttop', 'easeoutbottom',
	'zoomin', 'zoomout', 'zoominout', 'vpunch', 'hpunch', 'blinds',
	'squares', 'wipeleft', 'wiperight', 'wipeup', 'wipedown', 'slideleft',
	'slideright', 'slideup', 'slidedown', 'slideawayleft', 'slideawayright',
	'slideawayup', 'slideawaydown', 'pushright', 'pushleft', 'pushup',
	'pushdown', 'irisin', 'irisout', 'None'
];

// Transform properties
const transformProperties = [
	'pos', 'xpos', 'ypos', 'anchor', 'xanchor', 'yanchor',
	'align', 'xalign', 'yalign', 'xoffset', 'yoffset', 'offset',
	'rotate', 'rotate_pad', 'transform_anchor', 'zoom', 'xzoom', 'yzoom',
	'alpha', 'around', 'alignaround', 'angle', 'radius',
	'crop', 'corner1', 'corner2', 'size', 'subpixel',
	'delay', 'events', 'xpan', 'ypan', 'xtile', 'ytile',
	'matrixcolor', 'matrixtransform', 'blur', 'mesh'
];

// Screen properties
const screenProperties = [
	'modal', 'tag', 'zorder', 'variant', 'style_prefix',
	'layer', 'sensitive', 'predict', 'roll_forward'
];

// Style properties
const styleProperties = [
	'background', 'foreground', 'left_padding', 'right_padding',
	'top_padding', 'bottom_padding', 'xpadding', 'ypadding', 'padding',
	'left_margin', 'right_margin', 'top_margin', 'bottom_margin',
	'xmargin', 'ymargin', 'margin', 'xminimum', 'yminimum', 'minimum',
	'xmaximum', 'ymaximum', 'maximum', 'xsize', 'ysize', 'xysize',
	'xfill', 'yfill', 'area', 'spacing', 'first_spacing',
	'box_wrap', 'box_reverse', 'box_layout', 'order_reverse',
	'font', 'size', 'bold', 'italic', 'underline', 'strikethrough',
	'color', 'black_color', 'hyperlink_functions', 'vertical',
	'antialias', 'adjust_spacing', 'language', 'layout',
	'text_align', 'justify', 'text_y_fudge', 'line_spacing',
	'line_leading', 'newline_indent', 'kerning', 'outlines',
	'outline_scaling', 'min_width', 'textalign', 'slow_cps',
	'slow_cps_multiplier', 'slow_abortable'
];

// Built-in Ren'Py screens that don't need to be defined
const builtinScreens = new Set([
	'say', 'input', 'choice', 'nvl', 'notify', 'skip_indicator',
	'ctc', 'save', 'load', 'preferences', 'main_menu', 'game_menu',
	'navigation', 'about', 'help', 'keyboard_help', 'mouse_help',
	'gamepad_help', 'confirm', 'history', 'quick_menu'
]);

// Built-in images that are always available
const builtinImages = new Set([
	'black', 'white', 'transparent'
]);

// Common style prefixes used in Ren'Py
const stylePrefixes = [
	'input', 'choice', 'nvl', 'say', 'menu', 'button', 'bar',
	'vbar', 'scrollbar', 'vscrollbar', 'slider', 'vslider',
	'frame', 'window', 'text', 'label', 'prompt', 'pref',
	'navigation', 'confirm', 'history', 'help', 'quick'
];

connection.onInitialize((params: InitializeParams): InitializeResult => {
	workspaceFolders = params.workspaceFolders || [];

	// Index workspace on startup
	setTimeout(() => indexWorkspace(), 100);

	return {
		capabilities: {
			textDocumentSync: TextDocumentSyncKind.Incremental,
			completionProvider: {
				resolveProvider: true,
				triggerCharacters: ['.', ' ']
			},
			hoverProvider: true,
			documentSymbolProvider: true,
			definitionProvider: true,
			signatureHelpProvider: {
				triggerCharacters: ['(', ',']
			},
			workspaceSymbolProvider: true,
			referencesProvider: true,
			renameProvider: {
				prepareProvider: true
			},
			workspace: {
				workspaceFolders: {
					supported: true,
					changeNotifications: true
				}
			}
		}
	};
});

// Fetch configuration on startup
connection.onInitialized(async () => {
	try {
		const config = await connection.workspace.getConfiguration('renpyMagic');
		if (config) {
			globalSettings = {
				diagnostics: {
					warnUndefinedImages: config.diagnostics?.warnUndefinedImages ?? false
				},
				renpySdkPath: config.renpySdkPath ?? '',
				lint: {
					enabled: config.lint?.enabled ?? false,
					onSave: config.lint?.onSave ?? true
				}
			};
		}
	} catch (e) {
		// Configuration not available, use defaults
	}
});

// Handle configuration changes
connection.onDidChangeConfiguration(async () => {
	try {
		const config = await connection.workspace.getConfiguration('renpyMagic');
		if (config) {
			globalSettings = {
				diagnostics: {
					warnUndefinedImages: config.diagnostics?.warnUndefinedImages ?? false
				},
				renpySdkPath: config.renpySdkPath ?? '',
				lint: {
					enabled: config.lint?.enabled ?? false,
					onSave: config.lint?.onSave ?? true
				}
			};
		}
	} catch (e) {
		globalSettings = defaultSettings;
	}
	// Re-validate all open documents
	documents.all().forEach(validateDocument);
});

// Handle workspace folder changes
connection.onNotification('workspace/didChangeWorkspaceFolders', (params: { event: { added: WorkspaceFolder[], removed: WorkspaceFolder[] } }) => {
	// Add new folders
	for (const folder of params.event.added) {
		workspaceFolders.push(folder);
	}
	// Remove old folders
	for (const folder of params.event.removed) {
		const index = workspaceFolders.findIndex(f => f.uri === folder.uri);
		if (index >= 0) {
			workspaceFolders.splice(index, 1);
		}
	}
	// Re-index everything
	indexWorkspace();
});

// Watch for .rpy and asset file changes on disk (files not open in editor)
connection.onDidChangeWatchedFiles((params: DidChangeWatchedFilesParams) => {
	let needsReindex = false;
	let assetsChanged = false;
	for (const change of params.changes) {
		const filePath = URI.parse(change.uri).fsPath;
		if (filePath.endsWith('.rpy') || filePath.endsWith('.rpym')) {
			if (change.type === FileChangeType.Deleted) {
				// Remove symbols from deleted file
				for (const [name, defs] of symbolIndex) {
					const filtered = defs.filter(d => d.uri !== change.uri);
					if (filtered.length === 0) {
						symbolIndex.delete(name);
					} else {
						symbolIndex.set(name, filtered);
					}
				}
				needsReindex = true;
			} else {
				// Created or changed - re-index this file
				for (const [name, defs] of symbolIndex) {
					const filtered = defs.filter(d => d.uri !== change.uri);
					if (filtered.length === 0) {
						symbolIndex.delete(name);
					} else {
						symbolIndex.set(name, filtered);
					}
				}
				indexFile(filePath);
				needsReindex = true;
			}
		} else {
			// Asset file changed (image, video) - trigger lint without re-indexing symbols
			assetsChanged = true;
		}
	}
	if (needsReindex) {
		documents.all().forEach(validateDocument);
	}
	// Run Ren'Py lint if enabled (covers both .rpy changes and asset changes)
	if ((needsReindex || assetsChanged) && globalSettings.lint.enabled && globalSettings.lint.onSave) {
		scheduleLint();
	}
});

// Index all .rpy files in workspace
function indexWorkspace() {
	symbolIndex.clear();
	userFunctionSignatures.clear();

	for (const folder of workspaceFolders) {
		const folderPath = URI.parse(folder.uri).fsPath;
		connection.console.log(`Indexing workspace folder: ${folderPath}`);
		indexDirectory(folderPath);
		scanImageFiles(folderPath);
	}

	// Count labels for debugging
	let labelCount = 0;
	for (const [name, defs] of symbolIndex) {
		if (defs.some(d => d.kind === 'label')) {
			labelCount++;
		}
	}
	connection.console.log(`Indexed ${symbolIndex.size} symbols (${labelCount} labels, ${imageFilePaths.size} image files)`);

	// Fetch configuration and re-validate all open documents
	fetchConfigAndValidate();
}

async function fetchConfigAndValidate() {
	try {
		const config = await connection.workspace.getConfiguration('renpyMagic');
		connection.console.log(`Config: ${JSON.stringify(config)}`);
		if (config) {
			globalSettings = {
				diagnostics: {
					warnUndefinedImages: config.diagnostics?.warnUndefinedImages ?? false
				},
				renpySdkPath: config.renpySdkPath ?? '',
				lint: {
					enabled: config.lint?.enabled ?? false,
					onSave: config.lint?.onSave ?? true
				}
			};
		}
	} catch (e) {
		// Configuration not available, use defaults
	}
	// Re-validate all open documents
	documents.all().forEach(validateDocument);
}

function indexDirectory(dirPath: string) {
	try {
		const entries = fs.readdirSync(dirPath, { withFileTypes: true });

		for (const entry of entries) {
			const fullPath = path.join(dirPath, entry.name);

			if (entry.isDirectory() && !entry.name.startsWith('.')) {
				indexDirectory(fullPath);
			} else if (entry.isFile() && (entry.name.endsWith('.rpy') || entry.name.endsWith('.rpym'))) {
				indexFile(fullPath);
			}
		}
	} catch (e) {
		// Ignore errors (permission issues, etc.)
	}
}

function indexFile(filePath: string) {
	try {
		const content = fs.readFileSync(filePath, 'utf-8');
		const uri = URI.file(filePath).toString();
		indexContent(content, uri);
	} catch (e) {
		// Ignore errors
	}
}

function indexContent(content: string, uri: string) {
	try {
		const lines = content.split('\n');

		// Regex patterns for symbols
		// Note: Many Ren'Py statements can be prefixed with "init" or "init <priority>" (e.g., "init screen", "init -1 label")
		const patterns: Array<{ regex: RegExp; kind: SymbolDefinition['kind'] }> = [
			{ regex: /^(\s*)(?:init\s+(?:-?\d+\s+)?)?(label)\s+(\.?[a-zA-Z_][a-zA-Z0-9_.]*)/,  kind: 'label' },
			{ regex: /^(\s*)(?:init\s+(?:-?\d+\s+)?)?(screen)\s+([a-zA-Z_][a-zA-Z0-9_]*)/,  kind: 'screen' },
			{ regex: /^(\s*)(?:init\s+(?:-?\d+\s+)?)?(transform)\s+([a-zA-Z_][a-zA-Z0-9_]*)/,  kind: 'transform' },
			{ regex: /^(\s*)(?:init\s+(?:-?\d+\s+)?)?(image)\s+([a-zA-Z_][a-zA-Z0-9_ ]+)\s*=/,  kind: 'image' },
			{ regex: /^(\s*)(define)\s+([a-zA-Z_][a-zA-Z0-9_.]*)\s*=/,  kind: 'define' },
			{ regex: /^(\s*)(default)\s+([a-zA-Z_][a-zA-Z0-9_.]*)\s*=/,  kind: 'default' },
			{ regex: /^(\s*)(?:init\s+(?:-?\d+\s+)?)?(style)\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*:/,  kind: 'style' },
			{ regex: /^(\s*)(?:init\s+(?:-?\d+\s+)?)?(layeredimage)\s+([a-zA-Z_][a-zA-Z0-9_ ]+)\s*:/,  kind: 'layeredimage' },
			// Python function definitions - capture the full signature
			{ regex: /^(\s*)(def)\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/,  kind: 'python_function' },
			// Python class definitions
			{ regex: /^(\s*)(class)\s+([a-zA-Z_][a-zA-Z0-9_]*)/,  kind: 'python_class' },
		];

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];

			for (const { regex, kind } of patterns) {
				const match = line.match(regex);
				if (match) {
					const name = match[3].trim();
					const character = match[1].length + match[2].length + 1;

					const symbol: SymbolDefinition = {
						name,
						kind,
						uri,
						line: i,
						character
					};

					// For Python functions, extract parameters and create signature
					if (kind === 'python_function') {
						const funcMatch = line.match(/def\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(([^)]*)\)/);
						if (funcMatch) {
							const funcName = funcMatch[1];
							const params = funcMatch[2];
							symbol.parameters = params;

							// Create signature data for this function
							const paramList = params.split(',').map(p => p.trim()).filter(p => p);
							const sigData: SignatureData = {
								label: `${funcName}(${params})`,
								documentation: `User-defined function`,
								parameters: paramList.map(p => {
									// Handle default values like "number=1"
									const paramName = p.split('=')[0].trim();
									return {
										label: paramName,
										documentation: ''
									};
								})
							};
							userFunctionSignatures.set(funcName, sigData);
						}
					}

					// Add to index (multiple definitions possible)
					const existing = symbolIndex.get(name) || [];
					existing.push(symbol);
					symbolIndex.set(name, existing);

					// For images, extract the file path from the definition.
					// Take the first quoted asset path on the right-hand side of `=`,
					// which covers bare strings, Transform("..."), At("...", ...),
					// Movie(play="..."), and ConditionSwitch(...) (which can span
					// multiple lines, with paths on continuation lines).
					if (kind === 'image') {
						const eqIdx = line.indexOf('=');
						if (eqIdx >= 0) {
							const assetRegex = /["']([^"']+\.(?:png|jpg|jpeg|webp|mp4|webm|ogv|avi|mkv))["']/i;
							let rhs = line.substring(eqIdx + 1);
							let pathMatch = rhs.match(assetRegex);
							// If the path isn't on the first line and the
							// expression continues (unbalanced paren or
							// trailing comma/backslash), scan forward.
							const opensMulti = rhs.includes('(') && !rhs.match(/\)\s*$/);
							if (!pathMatch && opensMulti) {
								for (let j = i + 1; j < lines.length && j < i + 50; j++) {
									rhs += '\n' + lines[j];
									pathMatch = rhs.match(assetRegex);
									if (pathMatch) break;
									// Stop once the parens balance out
									let depth = 0;
									for (const ch of rhs) {
										if (ch === '(') depth++;
										else if (ch === ')') depth--;
									}
									if (depth <= 0) break;
								}
							}
							if (pathMatch) {
								symbol.imagePath = pathMatch[1];
							}
						}
					}

					// For images, index various combinations for flexible matching
					// e.g., "cg ch05 kelly_topless_01" should match "cg kelly_topless_01"
					if (kind === 'image') {
						const parts = name.split(/\s+/);
						if (parts.length > 1) {
							// Index the tag (first part)
							const tagSymbol: SymbolDefinition = { ...symbol, name: parts[0] };
							const tagExisting = symbolIndex.get(parts[0]) || [];
							tagExisting.push(tagSymbol);
							symbolIndex.set(parts[0], tagExisting);

							// Index full name without tag
							const restName = parts.slice(1).join(' ');
							const restSymbol: SymbolDefinition = { ...symbol, name: restName };
							const restExisting = symbolIndex.get(restName) || [];
							restExisting.push(restSymbol);
							symbolIndex.set(restName, restExisting);

							// Index tag + last part (e.g., "cg kelly_topless_01" from "cg ch05 kelly_topless_01")
							if (parts.length > 2) {
								const tagPlusLast = parts[0] + ' ' + parts[parts.length - 1];
								const tplSymbol: SymbolDefinition = { ...symbol, name: tagPlusLast };
								const tplExisting = symbolIndex.get(tagPlusLast) || [];
								tplExisting.push(tplSymbol);
								symbolIndex.set(tagPlusLast, tplExisting);
							}
						}
					}
				}
			}
		}
	} catch (e) {
		// Ignore errors
	}
}

const imageExtensions = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const videoExtensions = new Set(['.mp4', '.webm', '.ogv', '.avi', '.mkv']);

// Get image dimensions using image-size library (reads only file header)
function getImageDimensions(filePath: string): { width: number; height: number } | null {
	try {
		const sizeOf = require('image-size');
		const fd = fs.openSync(filePath, 'r');
		const buf = Buffer.alloc(64 * 1024);
		const bytesRead = fs.readSync(fd, buf, 0, buf.length, 0);
		fs.closeSync(fd);
		const dims = sizeOf.imageSize(buf.subarray(0, bytesRead));
		if (dims && dims.width && dims.height) {
			return { width: dims.width, height: dims.height };
		}
	} catch (e) {
		// Ignore errors
	}
	return null;
}

// Get the markdown sizing parameter for an image (fit within hover tooltip)
function getImageSizeParam(filePath: string): string {
	const dims = getImageDimensions(filePath);
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

function isVideoFile(filePath: string): boolean {
	return videoExtensions.has(path.extname(filePath).toLowerCase());
}

function getImageHoverContent(imageName: string, filePath: string): string {
	const fileUri = URI.file(filePath).toString();
	if (isVideoFile(filePath)) {
		return `${path.basename(filePath)} (video)`;
	}
	return `![${imageName}](${fileUri}|${getImageSizeParam(filePath)})`;
}

// Scan for image files in the workspace (Ren'Py auto-discovers images in images/ folder)
function scanImageFiles(rootPath: string) {
	imageFilePaths.clear();

	function scanDir(dirPath: string, prefix: string[]) {
		try {
			const entries = fs.readdirSync(dirPath, { withFileTypes: true });
			for (const entry of entries) {
				const fullPath = path.join(dirPath, entry.name);
				if (entry.isDirectory() && !entry.name.startsWith('.')) {
					scanDir(fullPath, [...prefix, entry.name]);
				} else if (entry.isFile()) {
					const ext = path.extname(entry.name).toLowerCase();
					if (imageExtensions.has(ext) || videoExtensions.has(ext)) {
						// Build the image name from directory structure + filename
						// e.g., images/eileen/happy.png -> "eileen happy"
						// e.g., images/cg/beach.png -> "cg beach"
						// e.g., images/bg room.png -> "bg room"
						const rawBase = path.basename(entry.name, ext);
						const baseName = rawBase.replace(/_/g, ' ');
						const nameParts = [...prefix, baseName];
						const imageName = nameParts.join(' ').toLowerCase();
						imageFilePaths.set(imageName, fullPath);

						// Also index with underscores preserved
						const nameWithUnderscores = [...prefix, rawBase].join(' ').toLowerCase();
						if (nameWithUnderscores !== imageName) {
							imageFilePaths.set(nameWithUnderscores, fullPath);
						}

						// Ren'Py auto-discovery is filename-based: a file
						// "bar_sunset_1.jpg" anywhere under images/ becomes the
						// image "bar_sunset_1" regardless of subdirectories.
						// Index the basename so references like `scene bar_sunset_1` resolve.
						const baseLower = rawBase.toLowerCase();
						if (!imageFilePaths.has(baseLower)) {
							imageFilePaths.set(baseLower, fullPath);
						}
						const baseSpacedLower = baseName.toLowerCase();
						if (baseSpacedLower !== baseLower && !imageFilePaths.has(baseSpacedLower)) {
							imageFilePaths.set(baseSpacedLower, fullPath);
						}
					}
				}
			}
		} catch (e) {
			// Ignore errors
		}
	}

	// Find game/images directories by looking at indexed .rpy file locations
	const gameDirs = new Set<string>();
	for (const [, defs] of symbolIndex) {
		for (const def of defs) {
			const gd = findGameDir(URI.parse(def.uri).fsPath);
			if (gd) gameDirs.add(gd);
		}
	}

	// Scan images/ inside each game dir
	for (const gd of gameDirs) {
		const imagesPath = path.join(gd, 'images');
		if (fs.existsSync(imagesPath)) {
			scanDir(imagesPath, []);
		}
	}

	// Also try workspace-relative paths
	const imagesDirs = ['images', 'game/images'];
	for (const dir of imagesDirs) {
		const imagesPath = path.join(rootPath, dir);
		if (fs.existsSync(imagesPath)) {
			scanDir(imagesPath, []);
		}
	}
}

// Resolve an image name to a file path
// Find the game/ directory by walking up from a file path
function findGameDir(filePath: string): string | null {
	let dir = path.dirname(filePath);
	// Walk up looking for a directory named "game"
	while (dir !== path.dirname(dir)) {
		if (path.basename(dir) === 'game') {
			return dir;
		}
		dir = path.dirname(dir);
	}
	return null;
}

function resolveImagePath(imageName: string): string | null {
	// 1. Check if the image definition has an explicit path
	const defs = symbolIndex.get(imageName);
	if (defs) {
		for (const def of defs) {
			if (def.kind === 'image' && def.imagePath) {
				// Resolve relative to the game/ directory
				// In Ren'Py, image paths are relative to game/
				// Find game/ dir by walking up from the defining .rpy file
				const defFilePath = URI.parse(def.uri).fsPath;
				const gameDir = findGameDir(defFilePath);
				if (gameDir) {
					const candidate = path.join(gameDir, def.imagePath);
					if (fs.existsSync(candidate)) {
						return candidate;
					}
				}
			}
		}
	}

	// 2. Check auto-discovered image files
	const normalizedName = imageName.toLowerCase();
	const filePath = imageFilePaths.get(normalizedName);
	if (filePath) return filePath;

	// 3. Try with underscores replaced by spaces
	const withSpaces = normalizedName.replace(/_/g, ' ');
	if (withSpaces !== normalizedName) {
		const filePath2 = imageFilePaths.get(withSpaces);
		if (filePath2) return filePath2;
	}

	return null;
}

// Get word at position
function getWordAtPosition(document: TextDocument, position: TextDocumentPositionParams['position']): string {
	const text = document.getText();
	const offset = document.offsetAt(position);

	// Find word boundaries (include dots for namespaced identifiers like config.name)
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

// Get context around position
function getLineContext(document: TextDocument, position: TextDocumentPositionParams['position']): string {
	const text = document.getText();
	const lines = text.split('\n');
	const line = lines[position.line] || '';
	// Don't trim - we need to preserve trailing spaces for completion suppression
	return line.substring(0, position.character);
}

// Signature information for functions/classes
interface SignatureData {
	label: string;
	documentation: string;
	parameters: Array<{
		label: string;
		documentation: string;
	}>;
}

const signatures: Record<string, SignatureData> = {
	'Dissolve': {
		label: 'Dissolve(time, alpha=False, time_warp=None)',
		documentation: 'A transition that dissolves from one scene to the next.',
		parameters: [
			{ label: 'time', documentation: 'The time the dissolve will take, in seconds' },
			{ label: 'alpha', documentation: 'If True, the dissolve uses the alpha channel' },
			{ label: 'time_warp', documentation: 'A function that maps time (0.0-1.0) to display progress' }
		]
	},
	'Fade': {
		label: 'Fade(out_time, hold_time, in_time, color="#000")',
		documentation: 'A transition that fades to a color, holds, then fades to the new scene.',
		parameters: [
			{ label: 'out_time', documentation: 'Time to fade to color' },
			{ label: 'hold_time', documentation: 'Time to hold on color' },
			{ label: 'in_time', documentation: 'Time to fade from color to new scene' },
			{ label: 'color', documentation: 'The color to fade to (default black)' }
		]
	},
	'ImageDissolve': {
		label: 'ImageDissolve(image, time, ramplen=8, reverse=False, alpha=True, time_warp=None)',
		documentation: 'A transition that dissolves using a grayscale image as a pattern.',
		parameters: [
			{ label: 'image', documentation: 'A grayscale image. White areas dissolve first, black areas last' },
			{ label: 'time', documentation: 'The time the transition takes' },
			{ label: 'ramplen', documentation: 'The length of the ramp in pixels' },
			{ label: 'reverse', documentation: 'If True, reverses the direction' },
			{ label: 'alpha', documentation: 'If True, use alpha channel' },
			{ label: 'time_warp', documentation: 'A function that maps time to display progress' }
		]
	},
	'Pixellate': {
		label: 'Pixellate(time, steps)',
		documentation: 'A transition that pixellates the old scene, then unpixellates the new scene.',
		parameters: [
			{ label: 'time', documentation: 'The time the transition takes' },
			{ label: 'steps', documentation: 'The number of pixellation steps' }
		]
	},
	'MoveTransition': {
		label: 'MoveTransition(delay, enter=None, leave=None, old=False, layers=["master"])',
		documentation: 'A transition that moves images to their new locations.',
		parameters: [
			{ label: 'delay', documentation: 'The time the transition takes' },
			{ label: 'enter', documentation: 'A transition to use for entering images' },
			{ label: 'leave', documentation: 'A transition to use for leaving images' },
			{ label: 'old', documentation: 'If True, use old positions' },
			{ label: 'layers', documentation: 'Layers to apply the transition to' }
		]
	},
	'Character': {
		label: 'Character(name, kind=adv, **properties)',
		documentation: 'Creates a character for use in dialogue.',
		parameters: [
			{ label: 'name', documentation: 'The name of the character, shown in dialogue' },
			{ label: 'kind', documentation: 'The kind of character (adv or nvl)' },
			{ label: '**properties', documentation: 'Additional properties like image, color, what_prefix, etc.' }
		]
	},
	'DynamicDisplayable': {
		label: 'DynamicDisplayable(function, *args, **kwargs)',
		documentation: 'A displayable that can change based on a Python function.',
		parameters: [
			{ label: 'function', documentation: 'A function called with (st, at, *args, **kwargs) returning (displayable, redraw_time)' },
			{ label: '*args', documentation: 'Positional arguments passed to the function' },
			{ label: '**kwargs', documentation: 'Keyword arguments passed to the function' }
		]
	},
	'Transform': {
		label: 'Transform(child=None, **properties)',
		documentation: 'A displayable that applies transformations to its child.',
		parameters: [
			{ label: 'child', documentation: 'The displayable to transform' },
			{ label: '**properties', documentation: 'Transform properties like pos, anchor, rotate, zoom, alpha, etc.' }
		]
	},
	'Solid': {
		label: 'Solid(color, **properties)',
		documentation: 'A displayable that fills the area with a solid color.',
		parameters: [
			{ label: 'color', documentation: 'The color (hex string like "#rgb" or "#rrggbb", or Color object)' },
			{ label: '**properties', documentation: 'Additional displayable properties' }
		]
	},
	'Frame': {
		label: 'Frame(image, left=0, top=0, right=None, bottom=None, tile=False, **properties)',
		documentation: 'A displayable that resizes an image while preserving corners/edges.',
		parameters: [
			{ label: 'image', documentation: 'The image to use as a frame' },
			{ label: 'left', documentation: 'Size of the left border that should not be scaled' },
			{ label: 'top', documentation: 'Size of the top border' },
			{ label: 'right', documentation: 'Size of the right border (defaults to left)' },
			{ label: 'bottom', documentation: 'Size of the bottom border (defaults to top)' },
			{ label: 'tile', documentation: 'If True, tiles the center and sides rather than scaling' }
		]
	},
	'Text': {
		label: 'Text(text, **properties)',
		documentation: 'A displayable that displays text.',
		parameters: [
			{ label: 'text', documentation: 'The text to display, may contain text tags like {b}bold{/b}' },
			{ label: '**properties', documentation: 'Properties like style, size, color, font, etc.' }
		]
	},
	'SetVariable': {
		label: 'SetVariable(name, value)',
		documentation: 'An action that sets a variable to a value.',
		parameters: [
			{ label: 'name', documentation: 'The name of the variable to set (as a string)' },
			{ label: 'value', documentation: 'The value to set it to' }
		]
	},
	'SetField': {
		label: 'SetField(object, field, value)',
		documentation: 'An action that sets a field on an object.',
		parameters: [
			{ label: 'object', documentation: 'The object to modify' },
			{ label: 'field', documentation: 'The name of the field (as a string)' },
			{ label: 'value', documentation: 'The value to set' }
		]
	},
	'Jump': {
		label: 'Jump(label)',
		documentation: 'An action that jumps to a label.',
		parameters: [
			{ label: 'label', documentation: 'The label to jump to' }
		]
	},
	'Call': {
		label: 'Call(label, *args, **kwargs)',
		documentation: 'An action that calls a label.',
		parameters: [
			{ label: 'label', documentation: 'The label to call' },
			{ label: '*args', documentation: 'Positional arguments to pass' },
			{ label: '**kwargs', documentation: 'Keyword arguments to pass' }
		]
	},
	'Show': {
		label: 'Show(screen, transition=None, **kwargs)',
		documentation: 'An action that shows a screen.',
		parameters: [
			{ label: 'screen', documentation: 'The name of the screen to show' },
			{ label: 'transition', documentation: 'A transition to use' },
			{ label: '**kwargs', documentation: 'Arguments to pass to the screen' }
		]
	},
	'Hide': {
		label: 'Hide(screen, transition=None)',
		documentation: 'An action that hides a screen.',
		parameters: [
			{ label: 'screen', documentation: 'The name of the screen to hide' },
			{ label: 'transition', documentation: 'A transition to use' }
		]
	},
	'Play': {
		label: 'Play(channel, file, **kwargs)',
		documentation: 'An action that plays audio.',
		parameters: [
			{ label: 'channel', documentation: 'The channel to play on (music, sound, voice, etc.)' },
			{ label: 'file', documentation: 'The audio file to play' },
			{ label: '**kwargs', documentation: 'Options like loop, fadein, fadeout' }
		]
	},
	'Stop': {
		label: 'Stop(channel, fadeout=0)',
		documentation: 'An action that stops audio.',
		parameters: [
			{ label: 'channel', documentation: 'The channel to stop' },
			{ label: 'fadeout', documentation: 'Time to fade out' }
		]
	},
	'Function': {
		label: 'Function(callable, *args, **kwargs)',
		documentation: 'An action that calls a Python function.',
		parameters: [
			{ label: 'callable', documentation: 'The function to call' },
			{ label: '*args', documentation: 'Positional arguments' },
			{ label: '**kwargs', documentation: 'Keyword arguments' }
		]
	},
	'If': {
		label: 'If(condition, true_action, false_action=None)',
		documentation: 'An action that performs one of two actions based on a condition.',
		parameters: [
			{ label: 'condition', documentation: 'A Python expression to evaluate' },
			{ label: 'true_action', documentation: 'Action to perform if condition is true' },
			{ label: 'false_action', documentation: 'Action to perform if condition is false' }
		]
	},
	'Confirm': {
		label: 'Confirm(prompt, yes_action, no_action=None, confirm_selected=False)',
		documentation: 'An action that shows a confirmation dialog.',
		parameters: [
			{ label: 'prompt', documentation: 'The prompt to display' },
			{ label: 'yes_action', documentation: 'Action to perform if user confirms' },
			{ label: 'no_action', documentation: 'Action to perform if user cancels' },
			{ label: 'confirm_selected', documentation: 'If True, confirm even if already selected' }
		]
	},
	'Notify': {
		label: 'Notify(message)',
		documentation: 'An action that displays a notification.',
		parameters: [
			{ label: 'message', documentation: 'The message to display' }
		]
	},
	'OpenURL': {
		label: 'OpenURL(url)',
		documentation: 'An action that opens a URL in the system browser.',
		parameters: [
			{ label: 'url', documentation: 'The URL to open' }
		]
	},
	'ConditionSwitch': {
		label: 'ConditionSwitch(*args, **properties)',
		documentation: 'A displayable that changes based on conditions.',
		parameters: [
			{ label: '*args', documentation: 'Alternating condition strings and displayables' },
			{ label: '**properties', documentation: 'Displayable properties' }
		]
	},
	'Movie': {
		label: 'Movie(fps=24, size=None, channel="movie", play=None, mask=None, **properties)',
		documentation: 'A displayable that plays a movie file.',
		parameters: [
			{ label: 'fps', documentation: 'The framerate of the movie' },
			{ label: 'size', documentation: 'The size to display the movie at' },
			{ label: 'channel', documentation: 'The audio channel to play sound on' },
			{ label: 'play', documentation: 'The movie file to play' },
			{ label: 'mask', documentation: 'A mask movie for alpha' }
		]
	},
	'renpy.pause': {
		label: 'renpy.pause(delay=None, hard=False)',
		documentation: 'Pauses the game for a specified amount of time.',
		parameters: [
			{ label: 'delay', documentation: 'The number of seconds to pause. If None, pauses until click.' },
			{ label: 'hard', documentation: 'If True, cannot be interrupted by clicking' }
		]
	},
	'renpy.say': {
		label: 'renpy.say(who, what, **kwargs)',
		documentation: 'Displays dialogue.',
		parameters: [
			{ label: 'who', documentation: 'The character speaking (or None for narration)' },
			{ label: 'what', documentation: 'The text to display' },
			{ label: '**kwargs', documentation: 'Additional parameters' }
		]
	},
	'renpy.show': {
		label: 'renpy.show(name, at_list=[], layer="master", what=None, zorder=0, tag=None, behind=[])',
		documentation: 'Shows an image on a layer.',
		parameters: [
			{ label: 'name', documentation: 'The name of the image to show (string or tuple)' },
			{ label: 'at_list', documentation: 'A list of transforms to apply' },
			{ label: 'layer', documentation: 'The layer to show the image on' },
			{ label: 'what', documentation: 'A displayable to show instead of looking up name' },
			{ label: 'zorder', documentation: 'The z-order of the image' },
			{ label: 'tag', documentation: 'The tag to use for the image' },
			{ label: 'behind', documentation: 'A list of tags to show behind' }
		]
	},
	'renpy.hide': {
		label: 'renpy.hide(name, layer="master")',
		documentation: 'Hides an image from a layer.',
		parameters: [
			{ label: 'name', documentation: 'The name of the image to hide' },
			{ label: 'layer', documentation: 'The layer to hide from' }
		]
	},
	'renpy.scene': {
		label: 'renpy.scene(layer="master")',
		documentation: 'Clears all images from a layer.',
		parameters: [
			{ label: 'layer', documentation: 'The layer to clear' }
		]
	},
	'renpy.with_statement': {
		label: 'renpy.with_statement(trans, always=False)',
		documentation: 'Applies a transition.',
		parameters: [
			{ label: 'trans', documentation: 'The transition to apply' },
			{ label: 'always', documentation: 'If True, always applies the transition' }
		]
	},
	'renpy.jump': {
		label: 'renpy.jump(label)',
		documentation: 'Jumps to a label.',
		parameters: [
			{ label: 'label', documentation: 'The label to jump to' }
		]
	},
	'renpy.call': {
		label: 'renpy.call(label, *args, **kwargs)',
		documentation: 'Calls a label.',
		parameters: [
			{ label: 'label', documentation: 'The label to call' },
			{ label: '*args', documentation: 'Positional arguments' },
			{ label: '**kwargs', documentation: 'Keyword arguments' }
		]
	},
	'renpy.return_statement': {
		label: 'renpy.return_statement(value=None)',
		documentation: 'Returns from a called label.',
		parameters: [
			{ label: 'value', documentation: 'The value to return' }
		]
	},
	'renpy.call_screen': {
		label: 'renpy.call_screen(name, *args, **kwargs)',
		documentation: 'Calls a screen and returns its result.',
		parameters: [
			{ label: 'name', documentation: 'The name of the screen to call' },
			{ label: '*args', documentation: 'Positional arguments passed to the screen' },
			{ label: '**kwargs', documentation: 'Keyword arguments passed to the screen' }
		]
	},
	'renpy.show_screen': {
		label: 'renpy.show_screen(name, *args, **kwargs)',
		documentation: 'Shows a screen.',
		parameters: [
			{ label: 'name', documentation: 'The name of the screen to show' },
			{ label: '*args', documentation: 'Positional arguments passed to the screen' },
			{ label: '**kwargs', documentation: 'Keyword arguments passed to the screen' }
		]
	},
	'renpy.hide_screen': {
		label: 'renpy.hide_screen(name, layer="screens")',
		documentation: 'Hides a screen.',
		parameters: [
			{ label: 'name', documentation: 'The name of the screen to hide' },
			{ label: 'layer', documentation: 'The layer the screen is on' }
		]
	},
	'renpy.get_screen': {
		label: 'renpy.get_screen(name, layer="screens")',
		documentation: 'Returns the ScreenDisplayable for a shown screen, or None.',
		parameters: [
			{ label: 'name', documentation: 'The name of the screen' },
			{ label: 'layer', documentation: 'The layer to search' }
		]
	},
	'renpy.notify': {
		label: 'renpy.notify(message)',
		documentation: 'Displays a notification message.',
		parameters: [
			{ label: 'message', documentation: 'The message to display' }
		]
	},
	'renpy.input': {
		label: 'renpy.input(prompt, default="", allow=None, exclude="{}", length=None, **kwargs)',
		documentation: 'Gets text input from the player.',
		parameters: [
			{ label: 'prompt', documentation: 'The prompt to display' },
			{ label: 'default', documentation: 'The default value' },
			{ label: 'allow', documentation: 'Characters that are allowed' },
			{ label: 'exclude', documentation: 'Characters that are not allowed' },
			{ label: 'length', documentation: 'Maximum length of input' }
		]
	},
	'renpy.music.play': {
		label: 'renpy.music.play(filenames, channel="music", loop=None, fadeout=None, synchro_start=False, fadein=0, tight=None, if_changed=False)',
		documentation: 'Plays music on a channel.',
		parameters: [
			{ label: 'filenames', documentation: 'The file(s) to play' },
			{ label: 'channel', documentation: 'The channel to play on' },
			{ label: 'loop', documentation: 'If True, loop the music' },
			{ label: 'fadeout', documentation: 'Time to fade out current music' },
			{ label: 'synchro_start', documentation: 'If True, sync with other channels' },
			{ label: 'fadein', documentation: 'Time to fade in' },
			{ label: 'tight', documentation: 'If True, no gap between loops' },
			{ label: 'if_changed', documentation: 'Only play if different from current' }
		]
	},
	'renpy.music.stop': {
		label: 'renpy.music.stop(channel="music", fadeout=None)',
		documentation: 'Stops music on a channel.',
		parameters: [
			{ label: 'channel', documentation: 'The channel to stop' },
			{ label: 'fadeout', documentation: 'Time to fade out' }
		]
	},
	'renpy.music.queue': {
		label: 'renpy.music.queue(filenames, channel="music", loop=None, clear_queue=True, fadein=0, tight=None)',
		documentation: 'Queues music to play after current music.',
		parameters: [
			{ label: 'filenames', documentation: 'The file(s) to queue' },
			{ label: 'channel', documentation: 'The channel' },
			{ label: 'loop', documentation: 'If True, loop after queue completes' },
			{ label: 'clear_queue', documentation: 'If True, clears existing queue' },
			{ label: 'fadein', documentation: 'Time to fade in' },
			{ label: 'tight', documentation: 'If True, no gap' }
		]
	},
	'renpy.sound.play': {
		label: 'renpy.sound.play(filename, channel="sound", loop=False)',
		documentation: 'Plays a sound effect.',
		parameters: [
			{ label: 'filename', documentation: 'The file to play' },
			{ label: 'channel', documentation: 'The channel to play on' },
			{ label: 'loop', documentation: 'If True, loop the sound' }
		]
	},
	'renpy.random.randint': {
		label: 'renpy.random.randint(a, b)',
		documentation: 'Returns a random integer N such that a <= N <= b.',
		parameters: [
			{ label: 'a', documentation: 'The minimum value' },
			{ label: 'b', documentation: 'The maximum value' }
		]
	},
	'renpy.random.choice': {
		label: 'renpy.random.choice(seq)',
		documentation: 'Returns a random element from the sequence.',
		parameters: [
			{ label: 'seq', documentation: 'The sequence to choose from' }
		]
	},
	'renpy.save': {
		label: 'renpy.save(filename, extra_info="")',
		documentation: 'Saves the game to a file.',
		parameters: [
			{ label: 'filename', documentation: 'The save slot name' },
			{ label: 'extra_info', documentation: 'Extra information to include' }
		]
	},
	'renpy.load': {
		label: 'renpy.load(filename)',
		documentation: 'Loads the game from a file.',
		parameters: [
			{ label: 'filename', documentation: 'The save slot name' }
		]
	},
	'renpy.movie_cutscene': {
		label: 'renpy.movie_cutscene(filename, delay=None, loops=0)',
		documentation: 'Plays a movie as a cutscene.',
		parameters: [
			{ label: 'filename', documentation: 'The movie file to play' },
			{ label: 'delay', documentation: 'Time to wait before allowing skip' },
			{ label: 'loops', documentation: 'Number of times to loop' }
		]
	},
	'renpy.transition': {
		label: 'renpy.transition(trans, layer=None, always=False)',
		documentation: 'Sets a transition for the next interaction.',
		parameters: [
			{ label: 'trans', documentation: 'The transition to use' },
			{ label: 'layer', documentation: 'The layer to apply it to' },
			{ label: 'always', documentation: 'If True, always show transition' }
		]
	},
	'SetScreenVariable': {
		label: 'SetScreenVariable(name, value)',
		documentation: 'An action that sets a screen-local variable.',
		parameters: [
			{ label: 'name', documentation: 'The name of the variable (as a string)' },
			{ label: 'value', documentation: 'The value to set' }
		]
	},
	'ToggleVariable': {
		label: 'ToggleVariable(name)',
		documentation: 'An action that toggles a boolean variable.',
		parameters: [
			{ label: 'name', documentation: 'The name of the variable to toggle (as a string)' }
		]
	},
	'ToggleField': {
		label: 'ToggleField(object, field)',
		documentation: 'An action that toggles a boolean field on an object.',
		parameters: [
			{ label: 'object', documentation: 'The object containing the field' },
			{ label: 'field', documentation: 'The name of the field (as a string)' }
		]
	},
	'ToggleScreenVariable': {
		label: 'ToggleScreenVariable(name)',
		documentation: 'An action that toggles a screen-local boolean variable.',
		parameters: [
			{ label: 'name', documentation: 'The name of the variable (as a string)' }
		]
	},
	'Return': {
		label: 'Return(value=None)',
		documentation: 'An action that returns a value from a screen called with call screen.',
		parameters: [
			{ label: 'value', documentation: 'The value to return' }
		]
	},
	'NullAction': {
		label: 'NullAction()',
		documentation: 'An action that does nothing, but makes the button sensitive.',
		parameters: []
	},
	'Quit': {
		label: 'Quit(confirm=True)',
		documentation: 'An action that quits the game.',
		parameters: [
			{ label: 'confirm', documentation: 'If True, show a confirmation dialog' }
		]
	},
	'MainMenu': {
		label: 'MainMenu(confirm=True)',
		documentation: 'An action that returns to the main menu.',
		parameters: [
			{ label: 'confirm', documentation: 'If True, show a confirmation dialog' }
		]
	},
	'ShowMenu': {
		label: 'ShowMenu(screen=None, *args, **kwargs)',
		documentation: 'An action that shows a menu screen.',
		parameters: [
			{ label: 'screen', documentation: 'The screen to show (defaults to preferences)' },
			{ label: '*args', documentation: 'Positional arguments' },
			{ label: '**kwargs', documentation: 'Keyword arguments' }
		]
	},
	'Start': {
		label: 'Start(label="start")',
		documentation: 'An action that starts the game.',
		parameters: [
			{ label: 'label', documentation: 'The label to start from' }
		]
	},
	'FileAction': {
		label: 'FileAction(name, page=None, **kwargs)',
		documentation: 'An action that saves or loads from a file slot.',
		parameters: [
			{ label: 'name', documentation: 'The slot name' },
			{ label: 'page', documentation: 'The save page' }
		]
	},
	'FileSave': {
		label: 'FileSave(name, confirm=True, newest=True, page=None, cycle=False, **kwargs)',
		documentation: 'An action that saves to a file slot.',
		parameters: [
			{ label: 'name', documentation: 'The slot name' },
			{ label: 'confirm', documentation: 'If True, confirm overwriting' },
			{ label: 'newest', documentation: 'If True, mark as newest save' },
			{ label: 'page', documentation: 'The save page' },
			{ label: 'cycle', documentation: 'If True, cycle through slots' }
		]
	},
	'FileLoad': {
		label: 'FileLoad(name, confirm=True, page=None, newest=True, **kwargs)',
		documentation: 'An action that loads from a file slot.',
		parameters: [
			{ label: 'name', documentation: 'The slot name' },
			{ label: 'confirm', documentation: 'If True, confirm loading' },
			{ label: 'page', documentation: 'The save page' },
			{ label: 'newest', documentation: 'If True, mark as newest' }
		]
	},
	'FileDelete': {
		label: 'FileDelete(name, confirm=True, page=None)',
		documentation: 'An action that deletes a save file.',
		parameters: [
			{ label: 'name', documentation: 'The slot name' },
			{ label: 'confirm', documentation: 'If True, confirm deletion' },
			{ label: 'page', documentation: 'The save page' }
		]
	},
	'Preference': {
		label: 'Preference(name, value=None)',
		documentation: 'An action that sets or toggles a preference.',
		parameters: [
			{ label: 'name', documentation: 'The preference name (e.g., "text speed", "auto-forward time")' },
			{ label: 'value', documentation: 'The value to set, or None to toggle' }
		]
	},
	'SetMute': {
		label: 'SetMute(channel, mute)',
		documentation: 'An action that mutes or unmutes an audio channel.',
		parameters: [
			{ label: 'channel', documentation: 'The channel to mute' },
			{ label: 'mute', documentation: 'True to mute, False to unmute' }
		]
	},
	'SetMixer': {
		label: 'SetMixer(mixer, volume)',
		documentation: 'An action that sets a mixer volume.',
		parameters: [
			{ label: 'mixer', documentation: 'The mixer name (e.g., "music", "sfx", "voice")' },
			{ label: 'volume', documentation: 'The volume (0.0 to 1.0)' }
		]
	},
	'Rollback': {
		label: 'Rollback()',
		documentation: 'An action that rolls back to a previous state.',
		parameters: []
	},
	'RollForward': {
		label: 'RollForward()',
		documentation: 'An action that rolls forward after a rollback.',
		parameters: []
	},
	'im.Composite': {
		label: 'im.Composite(size, *args)',
		documentation: 'Combines multiple images into one.',
		parameters: [
			{ label: 'size', documentation: 'The size of the resulting image (width, height)' },
			{ label: '*args', documentation: 'Alternating (position, image) pairs' }
		]
	},
	'im.Scale': {
		label: 'im.Scale(image, width, height)',
		documentation: 'Scales an image to a specific size.',
		parameters: [
			{ label: 'image', documentation: 'The image to scale' },
			{ label: 'width', documentation: 'The target width' },
			{ label: 'height', documentation: 'The target height' }
		]
	},
	'im.Crop': {
		label: 'im.Crop(image, rect)',
		documentation: 'Crops an image to a rectangle.',
		parameters: [
			{ label: 'image', documentation: 'The image to crop' },
			{ label: 'rect', documentation: 'The rectangle (x, y, width, height)' }
		]
	},
	'im.Alpha': {
		label: 'im.Alpha(image, alpha)',
		documentation: 'Changes the alpha of an image.',
		parameters: [
			{ label: 'image', documentation: 'The image to modify' },
			{ label: 'alpha', documentation: 'The alpha value (0.0 to 1.0)' }
		]
	},
	'im.MatrixColor': {
		label: 'im.MatrixColor(image, matrix)',
		documentation: 'Applies a color matrix to an image.',
		parameters: [
			{ label: 'image', documentation: 'The image to modify' },
			{ label: 'matrix', documentation: 'A 5x5 color matrix or im.matrix constant' }
		]
	},
	'LiveComposite': {
		label: 'LiveComposite(size, *args, **properties)',
		documentation: 'Combines multiple displayables at runtime.',
		parameters: [
			{ label: 'size', documentation: 'The size (width, height) or None to auto-detect' },
			{ label: '*args', documentation: 'Alternating (position, displayable) pairs' },
			{ label: '**properties', documentation: 'Additional properties' }
		]
	},
	'LiveCrop': {
		label: 'LiveCrop(rect, child, **properties)',
		documentation: 'Crops a displayable at runtime.',
		parameters: [
			{ label: 'rect', documentation: 'The crop rectangle (x, y, width, height)' },
			{ label: 'child', documentation: 'The displayable to crop' },
			{ label: '**properties', documentation: 'Additional properties' }
		]
	},
	'AlphaDissolve': {
		label: 'AlphaDissolve(control, delay=0.0, old_widget=None, new_widget=None, alpha=False)',
		documentation: 'A transition using an image as the alpha mask.',
		parameters: [
			{ label: 'control', documentation: 'A displayable that controls the alpha' },
			{ label: 'delay', documentation: 'Time for the transition' },
			{ label: 'old_widget', documentation: 'Override for the old displayable' },
			{ label: 'new_widget', documentation: 'Override for the new displayable' },
			{ label: 'alpha', documentation: 'If True, use alpha channel' }
		]
	},
	'CropMove': {
		label: 'CropMove(time, mode="slideright", startcrop=None, startpos=None, endcrop=None, endpos=None, topnew=True)',
		documentation: 'A transition that moves and crops.',
		parameters: [
			{ label: 'time', documentation: 'Time for the transition' },
			{ label: 'mode', documentation: 'The movement mode' },
			{ label: 'startcrop', documentation: 'Starting crop rectangle' },
			{ label: 'startpos', documentation: 'Starting position' },
			{ label: 'endcrop', documentation: 'Ending crop rectangle' },
			{ label: 'endpos', documentation: 'Ending position' },
			{ label: 'topnew', documentation: 'If True, new image is on top' }
		]
	},
	'PushMove': {
		label: 'PushMove(time, mode="pushright")',
		documentation: 'A transition that pushes one image with another.',
		parameters: [
			{ label: 'time', documentation: 'Time for the transition' },
			{ label: 'mode', documentation: 'Push direction (pushright, pushleft, pushup, pushdown)' }
		]
	},
	// Python built-in methods commonly used in Ren'Py
	'format': {
		label: 'str.format(*args, **kwargs)',
		documentation: 'Perform string formatting. Replacement fields are delimited by `{}`. For example: `"Hello, {}!".format(name)` or `"Chapter {0}: {1}".format(num, title)`.',
		parameters: [
			{ label: '*args', documentation: 'Positional arguments to insert into the format string at `{}` or `{0}`, `{1}`, etc.' },
			{ label: '**kwargs', documentation: 'Keyword arguments to insert into the format string at `{name}`, `{key}`, etc.' }
		]
	}
};

// Signature help handler
connection.onSignatureHelp((params: SignatureHelpParams): SignatureHelp | null => {
	const document = documents.get(params.textDocument.uri);
	if (!document) return null;

	const text = document.getText();
	const offset = document.offsetAt(params.position);
	const textBefore = text.substring(0, offset);

	// Find the function name before the opening parenthesis
	// Look backwards for the pattern: FunctionName(
	const match = textBefore.match(/([a-zA-Z_][a-zA-Z0-9_.]*)\s*\([^)]*$/);
	if (!match) return null;

	const funcName = match[1];

	// Check built-in signatures first, then user-defined functions
	let sigData: SignatureData | undefined = signatures[funcName];
	if (!sigData) {
		sigData = userFunctionSignatures.get(funcName);
	}
	if (!sigData) return null;

	// Count commas to determine which parameter we're on
	const afterParen = textBefore.substring(textBefore.lastIndexOf('(') + 1);
	const commaCount = (afterParen.match(/,/g) || []).length;
	const activeParameter = Math.min(commaCount, Math.max(0, sigData.parameters.length - 1));

	const sig: SignatureInformation = {
		label: sigData.label,
		documentation: {
			kind: MarkupKind.Markdown,
			value: sigData.documentation
		},
		parameters: sigData.parameters.map(p => ({
			label: p.label,
			documentation: {
				kind: MarkupKind.Markdown,
				value: p.documentation
			}
		}))
	};

	return {
		signatures: [sig],
		activeSignature: 0,
		activeParameter: activeParameter
	};
});

// Hover handler
connection.onHover((params: TextDocumentPositionParams): Hover | null => {
	const document = documents.get(params.textDocument.uri);
	if (!document) return null;

	const word = getWordAtPosition(document, params.position);
	if (!word) return null;

	// Check if it's a documented symbol
	const doc = getDoc(word);
	if (doc) {
		const categoryLabel: Record<string, string> = {
			'class': '(class)',
			'function': '(function)',
			'action': '(action)',
			'transition': '(transition)',
			'statement': '(statement)',
			'variable': '(variable)',
			'property': '(property)'
		};
		const label = categoryLabel[doc.category] || '';

		return {
			contents: {
				kind: MarkupKind.Markdown,
				value: `**${word}** ${label}\n\n\`\`\`\n${doc.signature}\n\`\`\`\n\n${doc.description}`
			}
		};
	}

	// Check if it's a keyword
	if (renpyKeywords.includes(word) || atlKeywords.includes(word)) {
		// Some keywords have documentation
		const keywordDoc = getDoc(word);
		if (keywordDoc) {
			return {
				contents: {
					kind: MarkupKind.Markdown,
					value: `**${word}** (keyword)\n\n\`\`\`\n${keywordDoc.signature}\n\`\`\`\n\n${keywordDoc.description}`
				}
			};
		}
		return {
			contents: {
				kind: MarkupKind.Markdown,
				value: `**${word}** (Ren'Py keyword)`
			}
		};
	}

	// Check if it's a property
	if (transformProperties.includes(word)) {
		return {
			contents: {
				kind: MarkupKind.Markdown,
				value: `**${word}** (transform property)`
			}
		};
	}

	if (styleProperties.includes(word)) {
		return {
			contents: {
				kind: MarkupKind.Markdown,
				value: `**${word}** (style property)`
			}
		};
	}

	if (builtinTransitions.includes(word)) {
		return {
			contents: {
				kind: MarkupKind.Markdown,
				value: `**${word}** (built-in transition)\n\nPre-defined transition for use with \`with\` statement.`
			}
		};
	}

	// Check if it's a Python built-in method with signature data
	const sigData = signatures[word];
	if (sigData) {
		return {
			contents: {
				kind: MarkupKind.Markdown,
				value: `**${word}**\n\n\`\`\`\n${sigData.label}\n\`\`\`\n\n${sigData.documentation}`
			}
		};
	}

	// Check for image preview on show/scene/hide statements
	const text = document.getText();
	const lines = text.split('\n');
	const line = lines[params.position.line] || '';
	const showMatch = line.match(/\b(show|scene)\s+(.+?)(?:\s+(?:at|with|as|behind|onlayer|zorder)\b|$)/);
	if (showMatch) {
		// Skip "show screen"
		const afterKeyword = showMatch[2].trim();
		if (!afterKeyword.startsWith('screen ')) {
			const imageName = afterKeyword;
			const namesToTry = [imageName];
			const parts = imageName.split(/\s+/);
			if (parts.length > 1) {
				// Try tag + last part (preserves character/CG identity)
				namesToTry.push(parts[0] + ' ' + parts[parts.length - 1]);
			}
			namesToTry.push(imageName.replace(/\s+/g, '_'));

			for (const name of namesToTry) {
				const imgPath = resolveImagePath(name);
				if (imgPath) {
					return {
						contents: {
							kind: MarkupKind.Markdown,
							value: getImageHoverContent(imageName, imgPath)
						}
					};
				}
			}
		}
	}

	// Check for image definition lines: image foo = "path.png"
	const imageDefMatch = line.match(/^\s*(?:init\s+(?:-?\d+\s+)?)?image\s+([a-zA-Z_][a-zA-Z0-9_ ]+?)\s*=/);
	if (imageDefMatch) {
		const imageName = imageDefMatch[1].trim();
		const imgPath = resolveImagePath(imageName);
		if (imgPath) {
			return {
				contents: {
					kind: MarkupKind.Markdown,
					value: getImageHoverContent(imageName, imgPath)
				}
			};
		}
	}

	return null;
});

// Completion handler
connection.onCompletion((params): CompletionItem[] => {
	const document = documents.get(params.textDocument.uri);
	if (!document) return [];

	const lineContext = getLineContext(document, params.position);

	// If triggered by space, only show completions for specific contexts (jump/call)
	if (params.context?.triggerCharacter === ' ') {
		if (!lineContext.match(/\b(jump|call)\s+$/)) {
			return [];
		}
	}

	// Don't show completions inside strings
	// Count quotes before cursor - if odd number, we're inside a string
	const doubleQuotes = (lineContext.match(/"/g) || []).length;
	const singleQuotes = (lineContext.match(/'/g) || []).length;
	if (doubleQuotes % 2 === 1 || singleQuotes % 2 === 1) {
		return [];
	}

	// Don't show completions after a complete namespace.member followed by space/=
	// Pattern: word.identifier followed by whitespace or = (not still typing)
	// This must be checked FIRST before any other completion logic
	if (lineContext.match(/\b[a-zA-Z_][a-zA-Z0-9_]*\.[a-zA-Z_][a-zA-Z0-9_]+[\s=]+$/)) {
		return [];
	}

	// Check for namespace completions (config., gui., renpy., build., etc.)
	// Pattern: namespace.partial_word at end of line
	const namespaceMatch = lineContext.match(/\b([a-zA-Z_][a-zA-Z0-9_]*)\.(\w*)$/);
	if (namespaceMatch) {
		const namespace = namespaceMatch[1];
		const entries = getEntriesByNamespace(namespace);

		if (entries.length > 0) {
			// Return ONLY completions for this namespace (no general completions)
			const nsItems: CompletionItem[] = [];
			entries.forEach((fullName, index) => {
				const varName = fullName.replace(namespace + '.', '');
				const doc = getDoc(fullName);
				nsItems.push({
					label: varName,
					kind: doc?.category === 'function' ? CompletionItemKind.Function : CompletionItemKind.Variable,
					detail: doc?.signature || `${namespace} member`,
					documentation: doc?.description,
					sortText: '0' + varName,
					data: 11000 + index
				});
			});
			return nsItems;
		}
		// If namespace has no entries, don't fall through to general completions
		// when we're clearly typing a dotted name
		return [];
	}

	const items: CompletionItem[] = [];

	// Add Ren'Py API completions
	getAllSymbols().forEach((symbol, index) => {
		const doc = getDoc(symbol);
		if (doc) {
			let kind: CompletionItemKind;
			switch (doc.category) {
				case 'class':
					kind = CompletionItemKind.Class;
					break;
				case 'function':
				case 'action':
					kind = CompletionItemKind.Function;
					break;
				case 'transition':
					kind = CompletionItemKind.Constant;
					break;
				case 'statement':
					kind = CompletionItemKind.Keyword;
					break;
				case 'variable':
					kind = CompletionItemKind.Variable;
					break;
				default:
					kind = CompletionItemKind.Text;
			}

			items.push({
				label: symbol,
				kind: kind,
				detail: doc.signature,
				documentation: doc.description,
				data: index
			});
		}
	});

	// Add keywords
	renpyKeywords.forEach((keyword, index) => {
		items.push({
			label: keyword,
			kind: CompletionItemKind.Keyword,
			detail: 'Ren\'Py keyword',
			data: 1000 + index
		});
	});

	// Add ATL keywords
	atlKeywords.forEach((keyword, index) => {
		items.push({
			label: keyword,
			kind: CompletionItemKind.Keyword,
			detail: 'ATL keyword',
			data: 2000 + index
		});
	});

	// After "style_prefix " (with space or quote), suggest style prefixes
	if (lineContext.match(/\bstyle_prefix\s+["']?\w*$/)) {
		const prefixItems: CompletionItem[] = [];
		stylePrefixes.forEach((prefix, index) => {
			prefixItems.push({
				label: prefix,
				kind: CompletionItemKind.Value,
				detail: 'style prefix',
				sortText: '0' + prefix,
				data: 12000 + index
			});
		});
		return prefixItems;
	}

	// Context-aware completions
	if (lineContext.includes('at ') || lineContext.match(/transform\s+\w*\s*\(/)) {
		// Transform context - add transform properties
		transformProperties.forEach((prop, index) => {
			items.push({
				label: prop,
				kind: CompletionItemKind.Property,
				detail: 'Transform property',
				data: 3000 + index
			});
		});
	}

	if (lineContext.includes('style ')) {
		// Style definition context
		styleProperties.forEach((prop, index) => {
			items.push({
				label: prop,
				kind: CompletionItemKind.Property,
				detail: 'Style property',
				data: 4000 + index
			});
		});
	}

	// When typing "style_" (likely wanting style_prefix), prioritize screen properties
	if (lineContext.match(/\bstyle_\w*$/) && !lineContext.includes('style_prefix')) {
		screenProperties.forEach((prop, index) => {
			items.push({
				label: prop,
				kind: CompletionItemKind.Property,
				detail: 'Screen property',
				sortText: '0' + prop, // Prioritize these
				data: 4500 + index
			});
		});
	}

	if (lineContext.includes('screen ')) {
		// Screen context
		screenProperties.forEach((prop, index) => {
			items.push({
				label: prop,
				kind: CompletionItemKind.Property,
				detail: 'Screen property',
				data: 5000 + index
			});
		});
	}

	// After "with" keyword, prioritize built-in transitions
	if (lineContext.match(/\bwith\s+\w*$/)) {
		builtinTransitions.forEach((trans, index) => {
			items.push({
				label: trans,
				kind: CompletionItemKind.Constant,
				detail: 'Built-in transition',
				sortText: '0' + trans, // Sort these first
				data: 6000 + index
			});
		});
	}

	// After "call screen" or "show screen", suggest screens (check this BEFORE jump/call)
	if (lineContext.match(/\b(call|show)\s+screen\s+[a-zA-Z_]*$/)) {
		// Return only screen completions in this context
		const screenItems: CompletionItem[] = [];

		// Add built-in screens
		builtinScreens.forEach((screen) => {
			screenItems.push({
				label: screen,
				kind: CompletionItemKind.Class,
				detail: 'built-in screen',
				sortText: '0' + screen,
				data: 9000
			});
		});

		// Add user-defined screens from index
		for (const [name, definitions] of symbolIndex) {
			if (definitions.some(d => d.kind === 'screen')) {
				screenItems.push({
					label: name,
					kind: CompletionItemKind.Class,
					detail: 'screen',
					sortText: '1' + name,
					data: 9001
				});
			}
		}

		return screenItems;
	}

	// After "jump" or "call" keyword (but NOT "call screen"), suggest labels
	// Use negative lookahead to exclude "call screen"
	if (lineContext.match(/\b(jump|call)\s+(?!screen\s)\.?[a-zA-Z_]*$/)) {
		const isLocalContext = lineContext.match(/\b(jump|call)\s+\./);

		// Return only label completions in this context
		const labelItems: CompletionItem[] = [];

		// Get local labels from current document
		const text = document.getText();
		const docLines = text.split('\n');
		let currentGlobalLabel: string | null = null;

		for (let i = 0; i < docLines.length; i++) {
			const labelMatch = docLines[i].match(/^(\s*)(label)\s+(\.?[a-zA-Z_][a-zA-Z0-9_.]*)/);
			if (labelMatch) {
				const labelName = labelMatch[3];
				if (labelName.startsWith('.')) {
					// Local label - suggest it with high priority
					labelItems.push({
						label: labelName,
						kind: CompletionItemKind.Function,
						detail: `local label (in ${currentGlobalLabel || 'unknown'})`,
						sortText: '00' + labelName, // Highest priority
						data: 7000 + i
					});
				} else {
					currentGlobalLabel = labelName;
					if (!isLocalContext) {
						// Global label - suggest it
						labelItems.push({
							label: labelName,
							kind: CompletionItemKind.Function,
							detail: 'label',
							sortText: '00' + labelName, // Highest priority
							data: 7000 + i
						});
					}
				}
			}
		}

		// Also add labels from the symbol index (from other files)
		if (!isLocalContext) {
			for (const [name, definitions] of symbolIndex) {
				if (definitions.some(d => d.kind === 'label') && !name.startsWith('.')) {
					// Avoid duplicates
					if (!labelItems.some(item => item.label === name)) {
						labelItems.push({
							label: name,
							kind: CompletionItemKind.Function,
							detail: 'label (workspace)',
							sortText: '01' + name, // High priority but after local
							data: 8000
						});
					}
				}
			}
		}

		return labelItems;
	}

	// Add user-defined functions from the symbol index to general completions
	for (const [name, definitions] of symbolIndex) {
		if (definitions.some(d => d.kind === 'python_function')) {
			items.push({
				label: name,
				kind: CompletionItemKind.Function,
				detail: 'function',
				data: 10000
			});
		}
	}

	return items;
});

// Completion resolve handler
connection.onCompletionResolve((item: CompletionItem): CompletionItem => {
	// Add more details if needed
	return item;
});

// Definition handler (F12 - Go to Definition)
connection.onDefinition((params: DefinitionParams): Definition | null => {
	const document = documents.get(params.textDocument.uri);
	if (!document) return null;

	const text = document.getText();
	const lines = text.split('\n');
	const line = lines[params.position.line] || '';

	// Get the word at cursor position
	const word = getWordAtPosition(document, params.position);
	if (!word) return null;

	// Also try to get a longer identifier (for things like "kelly_curtains_1" or "trust_push")
	const offset = document.offsetAt(params.position);
	let start = offset;
	let end = offset;

	// Expand to include dots and underscores for qualified names
	while (start > 0 && /[a-zA-Z0-9_.]/.test(text[start - 1])) {
		start--;
	}
	while (end < text.length && /[a-zA-Z0-9_.]/.test(text[end])) {
		end++;
	}
	const extendedWord = text.substring(start, end);

	// Check context to understand what we're looking for
	const linePrefix = line.substring(0, params.position.character);

	// Try different name variants
	const namesToTry: string[] = [extendedWord, word];

	// If the cursor sits inside a dotted expression like `CHAPTER_TITLES.get`,
	// also try the segment under the cursor so attribute access on a defined
	// symbol still resolves to the symbol itself.
	const segment = dottedSegmentAt(extendedWord, offset - start);
	if (segment && !namesToTry.includes(segment)) {
		namesToTry.push(segment);
	}

	// For "show cg something", try "cg something" as the image name
	const showMatch = line.match(/\b(show|scene|hide)\s+(.+?)(?:\s+(?:at|with|as|behind|onlayer|zorder)\b|$)/);
	if (showMatch) {
		const imageName = showMatch[2].trim();
		namesToTry.unshift(imageName);
		// Also try parts of the image name
		const parts = imageName.split(/\s+/);
		if (parts.length > 1) {
			namesToTry.unshift(parts.slice(1).join(' ')); // Without tag
			namesToTry.unshift(parts.join('_')); // With underscores
			// Try tag + last part (handles "cg kelly_topless_01" matching "cg ch05 kelly_topless_01")
			namesToTry.unshift(parts[0] + ' ' + parts[parts.length - 1]);
			// Try just the last part
			namesToTry.unshift(parts[parts.length - 1]);
		}
	}

	// For "jump label" or "call label"
	const jumpMatch = line.match(/\b(jump|call)\s+(\.?[a-zA-Z_][a-zA-Z0-9_.]*)/);
	if (jumpMatch) {
		namesToTry.unshift(jumpMatch[2]);
	}

	// For function calls like "trust_push(...)"
	const funcMatch = linePrefix.match(/([a-zA-Z_][a-zA-Z0-9_]*)\s*\($/);
	if (funcMatch) {
		namesToTry.unshift(funcMatch[1]);
	}

	// Look up in symbol index
	for (const name of namesToTry) {
		const definitions = symbolIndex.get(name);
		if (definitions && definitions.length > 0) {
			// Return all matching definitions
			return definitions.map(def => Location.create(
				def.uri,
				Range.create(
					Position.create(def.line, def.character),
					Position.create(def.line, def.character + def.name.length)
				)
			));
		}
	}

	return null;
});

// Document symbols handler (for Cmd+R / Go to Symbol)
connection.onDocumentSymbol((params: DocumentSymbolParams): DocumentSymbol[] => {
	const document = documents.get(params.textDocument.uri);
	if (!document) return [];

	const text = document.getText();
	const lines = text.split('\n');
	const symbols: DocumentSymbol[] = [];

	// Regular expressions for different symbol types
	const labelRegex = /^(\s*)(label)\s+(\.?[a-zA-Z_][a-zA-Z0-9_.]*)\s*(\([^)]*\))?\s*:/;
	const screenRegex = /^(\s*)(screen)\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*(\([^)]*\))?\s*:/;
	const transformRegex = /^(\s*)(transform)\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*(\([^)]*\))?\s*:/;
	const imageRegex = /^(\s*)(image)\s+([a-zA-Z_][a-zA-Z0-9_ ]+)\s*=/;
	const defineRegex = /^(\s*)(define)\s+([a-zA-Z_][a-zA-Z0-9_.]*)\s*=/;
	const defaultRegex = /^(\s*)(default)\s+([a-zA-Z_][a-zA-Z0-9_.]*)\s*=/;
	const styleRegex = /^(\s*)(style)\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*:/;
	const layeredimageRegex = /^(\s*)(layeredimage)\s+([a-zA-Z_][a-zA-Z0-9_ ]+)\s*:/;
	const initPythonRegex = /^(\s*)(init\s+python|python)\s*(early|hide)?\s*:/;
	const menuRegex = /^(\s*)(menu)\s*([a-zA-Z_][a-zA-Z0-9_]*)?\s*:/;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		let match: RegExpMatchArray | null;

		// Check for labels
		if ((match = line.match(labelRegex))) {
			const name = match[3];
			const params = match[4] || '';
			symbols.push({
				name: name + params,
				detail: 'label',
				kind: SymbolKind.Function,
				range: Range.create(Position.create(i, 0), Position.create(i, line.length)),
				selectionRange: Range.create(Position.create(i, match[1].length + match[2].length + 1), Position.create(i, match[1].length + match[2].length + 1 + name.length))
			});
		}
		// Check for screens
		else if ((match = line.match(screenRegex))) {
			const name = match[3];
			const params = match[4] || '';
			symbols.push({
				name: name + params,
				detail: 'screen',
				kind: SymbolKind.Class,
				range: Range.create(Position.create(i, 0), Position.create(i, line.length)),
				selectionRange: Range.create(Position.create(i, match[1].length + match[2].length + 1), Position.create(i, match[1].length + match[2].length + 1 + name.length))
			});
		}
		// Check for transforms
		else if ((match = line.match(transformRegex))) {
			const name = match[3];
			const params = match[4] || '';
			symbols.push({
				name: name + params,
				detail: 'transform',
				kind: SymbolKind.Function,
				range: Range.create(Position.create(i, 0), Position.create(i, line.length)),
				selectionRange: Range.create(Position.create(i, match[1].length + match[2].length + 1), Position.create(i, match[1].length + match[2].length + 1 + name.length))
			});
		}
		// Check for images
		else if ((match = line.match(imageRegex))) {
			const name = match[3].trim();
			symbols.push({
				name: name,
				detail: 'image',
				kind: SymbolKind.File,
				range: Range.create(Position.create(i, 0), Position.create(i, line.length)),
				selectionRange: Range.create(Position.create(i, match[1].length + match[2].length + 1), Position.create(i, match[1].length + match[2].length + 1 + name.length))
			});
		}
		// Check for define statements
		else if ((match = line.match(defineRegex))) {
			const name = match[3];
			symbols.push({
				name: name,
				detail: 'define',
				kind: SymbolKind.Constant,
				range: Range.create(Position.create(i, 0), Position.create(i, line.length)),
				selectionRange: Range.create(Position.create(i, match[1].length + match[2].length + 1), Position.create(i, match[1].length + match[2].length + 1 + name.length))
			});
		}
		// Check for default statements
		else if ((match = line.match(defaultRegex))) {
			const name = match[3];
			symbols.push({
				name: name,
				detail: 'default',
				kind: SymbolKind.Variable,
				range: Range.create(Position.create(i, 0), Position.create(i, line.length)),
				selectionRange: Range.create(Position.create(i, match[1].length + match[2].length + 1), Position.create(i, match[1].length + match[2].length + 1 + name.length))
			});
		}
		// Check for styles
		else if ((match = line.match(styleRegex))) {
			const name = match[3];
			symbols.push({
				name: name,
				detail: 'style',
				kind: SymbolKind.Struct,
				range: Range.create(Position.create(i, 0), Position.create(i, line.length)),
				selectionRange: Range.create(Position.create(i, match[1].length + match[2].length + 1), Position.create(i, match[1].length + match[2].length + 1 + name.length))
			});
		}
		// Check for layeredimage
		else if ((match = line.match(layeredimageRegex))) {
			const name = match[3].trim();
			symbols.push({
				name: name,
				detail: 'layeredimage',
				kind: SymbolKind.Class,
				range: Range.create(Position.create(i, 0), Position.create(i, line.length)),
				selectionRange: Range.create(Position.create(i, match[1].length + match[2].length + 1), Position.create(i, match[1].length + match[2].length + 1 + name.length))
			});
		}
		// Check for init python blocks
		else if ((match = line.match(initPythonRegex))) {
			const modifier = match[3] ? ' ' + match[3] : '';
			const name = match[2] + modifier;
			symbols.push({
				name: name,
				detail: 'python block',
				kind: SymbolKind.Namespace,
				range: Range.create(Position.create(i, 0), Position.create(i, line.length)),
				selectionRange: Range.create(Position.create(i, match[1].length), Position.create(i, match[1].length + match[2].length))
			});
		}
		// Check for named menus
		else if ((match = line.match(menuRegex)) && match[3]) {
			const name = match[3];
			symbols.push({
				name: name,
				detail: 'menu',
				kind: SymbolKind.Enum,
				range: Range.create(Position.create(i, 0), Position.create(i, line.length)),
				selectionRange: Range.create(Position.create(i, match[1].length + match[2].length + 1), Position.create(i, match[1].length + match[2].length + 1 + name.length))
			});
		}
	}

	return symbols;
});

// Workspace symbols handler (Cmd+T)
connection.onWorkspaceSymbol((params: WorkspaceSymbolParams): SymbolInformation[] => {
	const query = params.query.toLowerCase();
	const results: SymbolInformation[] = [];

	for (const [name, definitions] of symbolIndex) {
		// Filter by query
		if (query && !name.toLowerCase().includes(query)) {
			continue;
		}

		for (const def of definitions) {
			let kind: SymbolKind;
			switch (def.kind) {
				case 'label':
					kind = SymbolKind.Function;
					break;
				case 'screen':
					kind = SymbolKind.Class;
					break;
				case 'transform':
					kind = SymbolKind.Function;
					break;
				case 'image':
				case 'layeredimage':
					kind = SymbolKind.File;
					break;
				case 'define':
					kind = SymbolKind.Constant;
					break;
				case 'default':
					kind = SymbolKind.Variable;
					break;
				case 'style':
					kind = SymbolKind.Struct;
					break;
				case 'python_function':
					kind = SymbolKind.Function;
					break;
				case 'python_class':
					kind = SymbolKind.Class;
					break;
				default:
					kind = SymbolKind.Variable;
			}

			results.push({
				name: def.name,
				kind,
				location: Location.create(
					def.uri,
					Range.create(
						Position.create(def.line, def.character),
						Position.create(def.line, def.character + def.name.length)
					)
				),
				containerName: def.kind
			});
		}
	}

	return results;
});

// References handler (Find all references)
connection.onReferences((params: ReferenceParams): Location[] => {
	const document = documents.get(params.textDocument.uri);
	if (!document) return [];

	const word = getWordAtPosition(document, params.position);
	if (!word) return [];

	const locations: Location[] = [];

	// Search through all indexed files for references
	for (const folder of workspaceFolders) {
		const folderPath = URI.parse(folder.uri).fsPath;
		findReferencesInDirectory(folderPath, word, locations);
	}

	return locations;
});

function findReferencesInDirectory(dirPath: string, symbol: string, locations: Location[]) {
	try {
		const entries = fs.readdirSync(dirPath, { withFileTypes: true });

		for (const entry of entries) {
			const fullPath = path.join(dirPath, entry.name);

			if (entry.isDirectory() && !entry.name.startsWith('.')) {
				findReferencesInDirectory(fullPath, symbol, locations);
			} else if (entry.isFile() && (entry.name.endsWith('.rpy') || entry.name.endsWith('.rpym'))) {
				findReferencesInFile(fullPath, symbol, locations);
			}
		}
	} catch (e) {
		// Ignore errors
	}
}

function findReferencesInFile(filePath: string, symbol: string, locations: Location[]) {
	try {
		const content = fs.readFileSync(filePath, 'utf-8');
		const uri = URI.file(filePath).toString();
		const lines = content.split('\n');

		// Escape special regex characters in symbol
		const escapedSymbol = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

		// Patterns that reference symbols
		const patterns = [
			// jump/call label
			new RegExp(`\\b(jump|call)\\s+(${escapedSymbol})\\b`),
			// show/scene/hide image
			new RegExp(`\\b(show|scene|hide)\\s+[^\\n]*(\\b${escapedSymbol}\\b)`),
			// use screen
			new RegExp(`\\buse\\s+(${escapedSymbol})\\b`),
			// show screen
			new RegExp(`\\bshow\\s+screen\\s+(${escapedSymbol})\\b`),
			// action Show/Call/Jump with label
			new RegExp(`\\b(Show|Call|Jump)\\s*\\(\\s*["']?(${escapedSymbol})["']?`),
			// Variable/function usage
			new RegExp(`\\b${escapedSymbol}\\s*[\\(=]`),
			// Property access
			new RegExp(`\\b${escapedSymbol}\\b`),
		];

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];

			for (const pattern of patterns) {
				const match = line.match(pattern);
				if (match) {
					// Find the actual position of the symbol in the line
					const symbolIndex = line.indexOf(symbol, match.index);
					if (symbolIndex >= 0) {
						locations.push(Location.create(
							uri,
							Range.create(
								Position.create(i, symbolIndex),
								Position.create(i, symbolIndex + symbol.length)
							)
						));
						break; // Only one match per line per pattern
					}
				}
			}
		}
	} catch (e) {
		// Ignore errors
	}
}

// Prepare rename handler
connection.onPrepareRename((params: PrepareRenameParams): Range | null => {
	const document = documents.get(params.textDocument.uri);
	if (!document) return null;

	const word = getWordAtPosition(document, params.position);
	if (!word) return null;

	// Check if this symbol exists in our index
	const definitions = symbolIndex.get(word);
	if (!definitions || definitions.length === 0) {
		return null;
	}

	// Return the range of the word
	const text = document.getText();
	const offset = document.offsetAt(params.position);

	let start = offset;
	let end = offset;

	while (start > 0 && /[a-zA-Z0-9_]/.test(text[start - 1])) {
		start--;
	}
	while (end < text.length && /[a-zA-Z0-9_]/.test(text[end])) {
		end++;
	}

	return Range.create(
		document.positionAt(start),
		document.positionAt(end)
	);
});

// Rename handler
connection.onRenameRequest((params: RenameParams): WorkspaceEdit | null => {
	const document = documents.get(params.textDocument.uri);
	if (!document) return null;

	const word = getWordAtPosition(document, params.position);
	if (!word) return null;

	const newName = params.newName;
	const changes: { [uri: string]: TextEdit[] } = {};

	// Find all references and replace them
	for (const folder of workspaceFolders) {
		const folderPath = URI.parse(folder.uri).fsPath;
		collectRenameEdits(folderPath, word, newName, changes);
	}

	return { changes };
});

function collectRenameEdits(dirPath: string, oldName: string, newName: string, changes: { [uri: string]: TextEdit[] }) {
	try {
		const entries = fs.readdirSync(dirPath, { withFileTypes: true });

		for (const entry of entries) {
			const fullPath = path.join(dirPath, entry.name);

			if (entry.isDirectory() && !entry.name.startsWith('.')) {
				collectRenameEdits(fullPath, oldName, newName, changes);
			} else if (entry.isFile() && (entry.name.endsWith('.rpy') || entry.name.endsWith('.rpym'))) {
				collectRenameEditsInFile(fullPath, oldName, newName, changes);
			}
		}
	} catch (e) {
		// Ignore errors
	}
}

function collectRenameEditsInFile(filePath: string, oldName: string, newName: string, changes: { [uri: string]: TextEdit[] }) {
	try {
		const content = fs.readFileSync(filePath, 'utf-8');
		const uri = URI.file(filePath).toString();
		const lines = content.split('\n');
		const edits: TextEdit[] = [];

		// Find all occurrences of the old name as a whole word
		const escapedOldName = oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		const wordBoundaryRegex = new RegExp(`\\b${escapedOldName}\\b`, 'g');

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			let match;

			while ((match = wordBoundaryRegex.exec(line)) !== null) {
				edits.push({
					range: Range.create(
						Position.create(i, match.index),
						Position.create(i, match.index + oldName.length)
					),
					newText: newName
				});
			}
		}

		if (edits.length > 0) {
			changes[uri] = edits;
		}
	} catch (e) {
		// Ignore errors
	}
}

// ============================================================================
// Ren'Py Lint Integration
// ============================================================================

interface LintError {
	file: string;
	line: number;
	message: string;
	severity: 'error' | 'warning';
}

// Find the project root (directory containing 'game' folder)
function findProjectRoot(filePath: string): string | null {
	let dir = path.dirname(filePath);
	while (dir !== path.dirname(dir)) {
		if (fs.existsSync(path.join(dir, 'game'))) {
			return dir;
		}
		dir = path.dirname(dir);
	}
	return null;
}

// Parse Ren'Py lint output into structured errors
function parseLintOutput(output: string, projectRoot: string): LintError[] {
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

			// Check for continuation on next line (common in Ren'Py errors)
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

// Run Ren'Py lint on the project
function runRenpyLint(projectRoot: string): Promise<LintError[]> {
	return new Promise((resolve) => {
		const sdkPath = globalSettings.renpySdkPath;
		if (!sdkPath) {
			resolve([]);
			return;
		}

		// Determine the correct executable based on platform
		const isMac = process.platform === 'darwin';
		const isWindows = process.platform === 'win32';

		let renpyExecutable: string;
		if (isWindows) {
			renpyExecutable = path.join(sdkPath, 'renpy.exe');
		} else if (isMac) {
			// On macOS, use the executable inside renpy.app to avoid permission issues
			renpyExecutable = path.join(sdkPath, 'renpy.app', 'Contents', 'MacOS', 'renpy');
		} else {
			renpyExecutable = path.join(sdkPath, 'renpy.sh');
		}

		if (!fs.existsSync(renpyExecutable)) {
			connection.window.showErrorMessage(`Ren'Py executable not found at: ${renpyExecutable}. Please check your renpyMagic.renpySdkPath setting.`);
			resolve([]);
			return;
		}

		connection.console.log(`Running Ren'Py lint on: ${projectRoot}`);

		const args = [projectRoot, 'lint', '--error-code'];
		const options = {
			timeout: 60000, // 60 second timeout
			maxBuffer: 10 * 1024 * 1024, // 10MB buffer
			cwd: sdkPath, // Run from SDK directory
			env: {
				...process.env,
				// Suppress audio/video drivers for headless operation
				SDL_AUDIODRIVER: 'dummy',
				SDL_VIDEODRIVER: 'dummy',
				// Set RENPY_PATH for the executable to find its resources
				RENPY_PATH: sdkPath
			}
		};

		execFile(renpyExecutable, args, options, (error, stdout, stderr) => {
			const output = stdout + '\n' + stderr;

			// Check for permission or execution errors
			if (output.includes('Operation not permitted') || output.includes('Permission denied')) {
				connection.window.showErrorMessage(
					'Ren\'Py lint failed: Permission denied. On macOS, grant Full Disk Access to VS Code in System Settings → Privacy & Security.'
				);
				resolve([]);
				return;
			}

			// Ren'Py's `lint --error-code` exits non-zero whenever there are
			// any warnings, so a non-zero exit on its own doesn't mean lint
			// failed. Only treat it as a real failure when the output looks
			// like it didn't run a successful lint pass at all (no warnings
			// parsed AND no statistics summary).
			const ranSuccessfully =
				output.includes('Statistics:') ||
				output.includes('File "') ||
				/\.rpy[mc]?:\d+/.test(output);

			if (error && !ranSuccessfully) {
				const trimmedOutput = output.trim();
				connection.console.error(`Ren'Py lint failed (exit ${error.code ?? '?'}): ${error.message}`);
				if (trimmedOutput) {
					connection.console.error(`Ren'Py lint output:\n${trimmedOutput}`);
				}
				const detail = trimmedOutput
					? trimmedOutput.split('\n').slice(-5).join('\n')
					: error.message;
				connection.window.showErrorMessage(
					`Ren'Py lint failed to run. See "Ren'Py Language Support" output channel for details.\n\n${detail}`
				);
				resolve([]);
				return;
			}

			const errors = parseLintOutput(output, projectRoot);
			connection.console.log(`Ren'Py lint found ${errors.length} issues`);
			resolve(errors);
		});
	});
}

// Convert lint errors to VS Code diagnostics
function lintErrorsToDiagnostics(errors: LintError[], projectRoot: string): Map<string, Diagnostic[]> {
	const diagnosticsMap = new Map<string, Diagnostic[]>();

	for (const error of errors) {
		// Resolve relative paths
		let filePath = error.file;
		if (!path.isAbsolute(filePath)) {
			filePath = path.join(projectRoot, filePath);
		}

		// Normalize path and convert to URI
		filePath = path.normalize(filePath);
		const uri = URI.file(filePath).toString();

		if (!diagnosticsMap.has(uri)) {
			diagnosticsMap.set(uri, []);
		}

		const lineNum = Math.max(0, error.line - 1); // Convert to 0-based
		const diagnostic: Diagnostic = {
			severity: error.severity === 'error' ? DiagnosticSeverity.Error : DiagnosticSeverity.Warning,
			range: Range.create(
				Position.create(lineNum, 0),
				Position.create(lineNum, 1000) // Highlight whole line
			),
			message: error.message,
			source: 'renpy-lint'
		};

		diagnosticsMap.get(uri)!.push(diagnostic);
	}

	return diagnosticsMap;
}

// Run lint with debouncing
function scheduleLint() {
	if (!globalSettings.lint.enabled || !globalSettings.renpySdkPath) {
		return;
	}

	// If lint is already running, mark that we need another run when it finishes
	if (lintIsRunning) {
		lintPendingAfterCurrent = true;
		return;
	}

	// Clear any pending lint
	if (lintDebounceTimer) {
		clearTimeout(lintDebounceTimer);
	}

	// Debounce: wait 2 seconds after last change before running lint
	lintDebounceTimer = setTimeout(async () => {
		lintDebounceTimer = null;

		// Find project root from any open document
		const docs = documents.all();
		if (docs.length === 0) return;

		const filePath = URI.parse(docs[0].uri).fsPath;
		const projectRoot = findProjectRoot(filePath);
		if (!projectRoot) {
			connection.console.log('Could not find Ren\'Py project root (no game/ folder)');
			return;
		}

		lintIsRunning = true;
		try {
			const errors = await runRenpyLint(projectRoot);
			const newDiagnostics = lintErrorsToDiagnostics(errors, projectRoot);

			// Clear old lint diagnostics
			for (const [uri] of lintDiagnostics) {
				if (!newDiagnostics.has(uri)) {
					lintDiagnostics.delete(uri);
					// Re-send diagnostics for this file without lint errors
					const doc = documents.get(uri);
					if (doc) {
						validateDocument(doc);
					} else {
						connection.sendDiagnostics({ uri, diagnostics: [] });
					}
				}
			}

			// Update lint diagnostics
			lintDiagnostics.clear();
			for (const [uri, diags] of newDiagnostics) {
				lintDiagnostics.set(uri, diags);
			}

			// Re-validate all open documents to merge diagnostics
			documents.all().forEach(validateDocument);

		} catch (e) {
			connection.console.error(`Ren'Py lint failed: ${e}`);
		} finally {
			lintIsRunning = false;
			// If files changed while lint was running, schedule another run
			if (lintPendingAfterCurrent) {
				lintPendingAfterCurrent = false;
				scheduleLint();
			}
		}
	}, 2000);
}

// ============================================================================
// Built-in Validation
// ============================================================================

// Check if a line is inside a comment or string context
function isInComment(line: string): boolean {
	const trimmed = line.trim();
	return trimmed.startsWith('#') || trimmed.startsWith('##');
}

// Check if we're inside a multiline string (triple quotes)
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

// Diagnostics - validate documents
async function validateDocument(textDocument: TextDocument): Promise<void> {
	const text = textDocument.getText();
	const lines = text.split('\n');
	const diagnostics: Diagnostic[] = [];

	// First pass: collect local labels in this file
	const localLabels = new Set<string>();
	let currentGlobalLabel: string | null = null;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const labelMatch = line.match(/^(\s*)(label)\s+(\.?[a-zA-Z_][a-zA-Z0-9_.]*)/);
		if (labelMatch) {
			const labelName = labelMatch[3];
			if (labelName.startsWith('.')) {
				// Local label
				if (currentGlobalLabel) {
					localLabels.add(currentGlobalLabel + labelName);
				}
				localLabels.add(labelName);
			} else {
				currentGlobalLabel = labelName;
			}
		}
	}

	// Second pass: check for issues
	currentGlobalLabel = null;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];

		// Skip comments and multiline strings
		if (isInComment(line) || isInMultilineString(lines, i)) {
			continue;
		}

		// Track current global label for local label resolution
		const labelDefMatch = line.match(/^(\s*)(label)\s+([a-zA-Z_][a-zA-Z0-9_.]*)/);
		if (labelDefMatch && !labelDefMatch[3].startsWith('.')) {
			currentGlobalLabel = labelDefMatch[3];
		}

		// Check for jump/call to undefined labels
		// IMPORTANT: Check for "call screen" first to avoid false positive on "screen"
		const callScreenCheck = line.match(/^\s*call\s+screen\s/);
		if (callScreenCheck) {
			// Skip - this is "call screen", not "call label"
			// The screen validation is handled separately below
		}

		// More specific regex to avoid matching inside strings or other contexts
		// Use negative lookahead to exclude "call screen"
		const jumpMatch = !callScreenCheck && line.match(/^\s*(jump|call)\s+(\.?[a-zA-Z_][a-zA-Z0-9_.]*)/);
		if (jumpMatch) {
			const labelName = jumpMatch[2];

			// For local labels, check if they exist in this file
			if (labelName.startsWith('.')) {
				const fullLocalName = currentGlobalLabel ? currentGlobalLabel + labelName : labelName;
				if (!localLabels.has(labelName) && !localLabels.has(fullLocalName)) {
					const startChar = line.indexOf(labelName, jumpMatch.index);
					diagnostics.push({
						severity: DiagnosticSeverity.Warning,
						range: Range.create(
							Position.create(i, startChar),
							Position.create(i, startChar + labelName.length)
						),
						message: `Local label "${labelName}" is not defined in this file`,
						source: 'renpy'
					});
				}
			} else {
				const definitions = symbolIndex.get(labelName);
				if (!definitions || !definitions.some(d => d.kind === 'label')) {
					const startChar = line.indexOf(labelName, jumpMatch.index);
					diagnostics.push({
						severity: DiagnosticSeverity.Warning,
						range: Range.create(
							Position.create(i, startChar),
							Position.create(i, startChar + labelName.length)
						),
						message: `Label "${labelName}" is not defined`,
						source: 'renpy'
					});
				}
			}
		}

		// Check for show/scene with undefined images - but skip "show screen" which is handled separately
		const showScreenCheck = line.match(/^\s*show\s+screen\s/);
		const showMatch = !showScreenCheck && line.match(/^\s*(show|scene)\s+([a-zA-Z_][a-zA-Z0-9_ ]+?)(?:\s+(?:at|with|as|behind|onlayer|zorder)\b|$)/);
		if (showMatch) {
			const imageName = showMatch[2].trim();
			const parts = imageName.split(/\s+/);
			let found = false;

			// Check built-in images
			if (builtinImages.has(imageName) || builtinImages.has(parts[0])) {
				found = true;
			}

			// Check full name
			if (!found && symbolIndex.has(imageName)) {
				found = true;
			}

			// Check tag + last part
			if (!found && parts.length > 1) {
				const tagPlusLast = parts[0] + ' ' + parts[parts.length - 1];
				if (symbolIndex.has(tagPlusLast)) {
					found = true;
				}
				// Also check tag + any middle/last parts combination
				for (let j = 1; j < parts.length; j++) {
					const combo = parts[0] + ' ' + parts.slice(j).join(' ');
					if (symbolIndex.has(combo)) {
						found = true;
						break;
					}
				}
			}

			// Check just the tag - only for layeredimage (which dynamically composes images)
			// Don't skip for regular images since those need explicit definitions
			if (!found && symbolIndex.has(parts[0])) {
				const defs = symbolIndex.get(parts[0]);
				if (defs && defs.some(d => d.kind === 'layeredimage')) {
					found = true;
				}
			}

			// Check auto-discovered image files (Ren'Py resolves images from
			// the images/ folder at runtime, even without an explicit image declaration)
			if (!found) {
				if (resolveImagePath(imageName)) {
					found = true;
				}
			}

			// Only warn if setting is enabled (disabled by default because images are often defined as files)
			if (!found && globalSettings.diagnostics.warnUndefinedImages) {
				const startChar = line.indexOf(imageName, showMatch.index);
				diagnostics.push({
					severity: DiagnosticSeverity.Warning,
					range: Range.create(
						Position.create(i, startChar),
						Position.create(i, startChar + imageName.length)
					),
					message: `Image "${imageName}" is not defined in code`,
					source: 'renpy'
				});
			}
		}

		// Check for call screen with undefined screen
		const callScreenMatch = line.match(/^\s*call\s+screen\s+([a-zA-Z_][a-zA-Z0-9_]*)/);
		if (callScreenMatch) {
			const screenName = callScreenMatch[1];
			if (!builtinScreens.has(screenName)) {
				const definitions = symbolIndex.get(screenName);
				if (!definitions || !definitions.some(d => d.kind === 'screen')) {
					const startChar = line.indexOf(screenName, callScreenMatch.index);
					diagnostics.push({
						severity: DiagnosticSeverity.Warning,
						range: Range.create(
							Position.create(i, startChar),
							Position.create(i, startChar + screenName.length)
						),
						message: `Screen "${screenName}" is not defined`,
						source: 'renpy'
					});
				}
			}
		}

		// Check for show screen with undefined screen
		const showScreenMatch = line.match(/^\s*show\s+screen\s+([a-zA-Z_][a-zA-Z0-9_]*)/);
		if (showScreenMatch) {
			const screenName = showScreenMatch[1];
			if (!builtinScreens.has(screenName)) {
				const definitions = symbolIndex.get(screenName);
				if (!definitions || !definitions.some(d => d.kind === 'screen')) {
					const startChar = line.indexOf(screenName, showScreenMatch.index);
					diagnostics.push({
						severity: DiagnosticSeverity.Warning,
						range: Range.create(
							Position.create(i, startChar),
							Position.create(i, startChar + screenName.length)
						),
						message: `Screen "${screenName}" is not defined`,
						source: 'renpy'
					});
				}
			}
		}

		// Check for use screen - but be more specific to avoid false positives
		// Must be at start of line (with indentation) and followed by identifier
		const useMatch = line.match(/^(\s*)use\s+([a-zA-Z_][a-zA-Z0-9_]*)(?:\s*\(|\s*$|\s*:)/);
		if (useMatch) {
			const screenName = useMatch[2];
			if (!builtinScreens.has(screenName)) {
				const definitions = symbolIndex.get(screenName);
				if (!definitions || !definitions.some(d => d.kind === 'screen')) {
					const startChar = line.indexOf(screenName, useMatch[1].length + 4);
					diagnostics.push({
						severity: DiagnosticSeverity.Warning,
						range: Range.create(
							Position.create(i, startChar),
							Position.create(i, startChar + screenName.length)
						),
						message: `Screen "${screenName}" is not defined`,
						source: 'renpy'
					});
				}
			}
		}

		// Check for mismatched quotes - but handle triple quotes properly
		// Skip lines that are part of triple-quoted strings
		const tripleQuotes = (line.match(/"""/g) || []).length;
		if (tripleQuotes === 0) {
			// No triple quotes on this line, check for regular quote matching
			// But skip if we might be in a multiline string
			if (!isInMultilineString(lines, i)) {
				const quoteCount = (line.match(/"/g) || []).length;
				const escapedQuotes = (line.match(/\\"/g) || []).length;
				if ((quoteCount - escapedQuotes) % 2 !== 0) {
					diagnostics.push({
						severity: DiagnosticSeverity.Error,
						range: Range.create(
							Position.create(i, 0),
							Position.create(i, line.length)
						),
						message: 'Mismatched quotes',
						source: 'renpy'
					});
				}
			}
		}
	}

	// Merge with lint diagnostics if available
	const lintDiags = lintDiagnostics.get(textDocument.uri) || [];
	const allDiagnostics = [...diagnostics, ...lintDiags];

	// Send diagnostics
	connection.sendDiagnostics({ uri: textDocument.uri, diagnostics: allDiagnostics });
}

// Validate documents on open and save
documents.onDidOpen((event) => {
	validateDocument(event.document);
});

documents.onDidChangeContent((change) => {
	const uri = change.document.uri;
	if (uri.endsWith('.rpy') || uri.endsWith('.rpym')) {
		// Remove old symbols from this file
		for (const [name, defs] of symbolIndex) {
			const filtered = defs.filter(d => d.uri !== uri);
			if (filtered.length === 0) {
				symbolIndex.delete(name);
			} else {
				symbolIndex.set(name, filtered);
			}
		}
		// Re-index from in-memory content
		indexContent(change.document.getText(), uri);
	}
	validateDocument(change.document);
});

// Re-index the file when it's saved
documents.onDidSave((event) => {
	const filePath = URI.parse(event.document.uri).fsPath;
	if (filePath.endsWith('.rpy') || filePath.endsWith('.rpym')) {
		// Remove old symbols from this file
		for (const [name, defs] of symbolIndex) {
			const filtered = defs.filter(d => d.uri !== event.document.uri);
			if (filtered.length === 0) {
				symbolIndex.delete(name);
			} else {
				symbolIndex.set(name, filtered);
			}
		}
		// Re-index this file
		indexFile(filePath);
		connection.console.log(`Re-indexed ${filePath}`);
		// Re-validate all open documents so diagnostics update across files
		documents.all().forEach(validateDocument);

		// Schedule Ren'Py lint if enabled
		if (globalSettings.lint.enabled && globalSettings.lint.onSave) {
			scheduleLint();
		}
	}
});

// Clear diagnostics when document is closed
documents.onDidClose((event) => {
	connection.sendDiagnostics({ uri: event.document.uri, diagnostics: [] });
});

// Make the text document manager listen on the connection
documents.listen(connection);

// Listen on the connection
connection.listen();
