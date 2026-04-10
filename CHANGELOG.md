# Changelog

## [1.0.9] - 2026-04-10

### Added
- Hover and signature help for Python built-in methods (e.g. `str.format()`)
- File system watcher to re-index workspace when `.rpy` files are changed on disk
- GitHub action to run tests on push and pull request

### Fixed
- Syntax highlighting for escaped brackets `[[` and `{{` in strings
- Nested string interpolation (e.g. `[CHAPTER_SUBTITLES[5]]`) now highlights correctly

## [1.0.8] - 2026-04-02

### Added
- Syntax highlighting for text tags and interpolation inside dialogue strings
- `centered` and `extend` keywords

### Changed
- Symbol index now updates on content change (not just on save)

### Fixed
- Auto-completion no longer triggers in wrong contexts (inside strings, on space for indentation)
- Space trigger character now only activates for `jump` and `call` completions
- Re-indexing on save now re-validates all open documents across files

## [1.0.6] - 2026-03-30

### Fixed
- Documentation and metadata fixes

## [1.0.5] - 2026-03-30

### Fixed
- Fixed repository name in metadata

## [1.0.4] - 2026-03-30

### Changed
- Updated documentation and README with screenshots
- Added more tests

### Fixed
- Fixed website build for image assets

## [1.0.3] - 2026-03-30

### Added
- Optional `warnUndefinedImages` setting to warn when `show`/`scene` references an undefined image (disabled by default)

### Fixed
- Fixed incorrect detection of screens (init prefix handling)
- Fixed detection of missing assets timing issue (validation now runs after indexing)

## [0.1.0] - 2026-03-27

### Added
- Full syntax highlighting for `.rpy` and `.rpym` files
- Hover documentation with 730+ API entries from official Ren'Py documentation
  - `config.*` variables (286 entries)
  - `gui.*` variables (107 entries)
  - `build.*` variables (18 entries)
  - Actions, style properties, transform properties, classes, and transitions
- Go to Symbol in Editor (Cmd+Shift+O / Ctrl+Shift+O)
- Workspace Symbol Search (Cmd+T / Ctrl+T)
- Go to Definition (F12) for labels, screens, images, transforms, and functions
- Find All References (Shift+F12)
- Rename Symbol (F2)
- Context-aware completions
  - Namespace completions for `config.`, `gui.`, `build.`
  - ATL and transform properties
  - Style properties and screen properties
  - Built-in transitions
  - Labels and screens
- Signature help for 60+ Ren'Py functions
- Diagnostics for undefined labels, screens, and mismatched quotes
