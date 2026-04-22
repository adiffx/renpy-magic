# Ren'Py Magic for VSCode

<img src="./images/full_icon.png" align="left" style="margin-right:15px; height: 100px; "/> 
 
 A Visual Studio Code extension that adds rich language support for the Ren’Py visual novel engine.

I originally made this for myself after running into a few small annoyances with existing extensions — mainly wanting to jump to labels in current file, check whether an image reference actually exists, and jump to image definitions with `F12`.

I kept adding things as I needed them while working on projects, and over time it just grew into something more complete. It’s still very much shaped by what I personally find useful, but it might be helpful to others too. It's powered by a proper language server (LSP), which makes features like navigation, diagnostics, and completions more consistent and reliable.

## 🚀 Installation

[Install Ren'Py Magic from VSCode Marketplace](https://marketplace.visualstudio.com/items?itemName=adiffx.renpy-language-support)

Or search for "**Ren'Py Magic**" in your Visual Studio Code Extension tab.

## ✨ Features

### 🎨 Syntax Highlighting

* Full highlighting for `.rpy` and `.rpym` files
* Supports:
  * Ren’Py script syntax
  * ATL (Animation and Transformation Language)
  * Embedded Python blocks
* Highlights string interpolation and text tags inside dialogue

### 📖 Hover Documentation

<img src="./images/screenshots/InlineDocumentation.png" width="642" />

* Hover over keywords, functions, and classes to view inline documentation
* Covers **730+ API entries** sourced from official Ren'Py docs:

| Category             | Examples                             |
| -------------------- | ------------------------------------ |
| `config.*`           | `config.name`, `config.screen_width` |
| `gui.*`              | `gui.text_color`, `gui.show_name`    |
| `build.*`            | `build.name`, `build.directory_name` |
| Actions              | `Jump`, `Call`, `Show`, `Hide`       |
| Style properties     | `background`, `padding`, `color`     |
| Transform properties | `xpos`, `ypos`, `zoom`, `alpha`      |

Also includes:

* Classes and transitions (`Transform`, `Dissolve`, `Fade`, etc.)
* Full support for dotted names (e.g. `config.name`)

#### Image preview

Image preview on hover — hover over `show` or `scene` statements to see a preview of the referenced sprite, scene or CG.

<img src="./images/screenshots/ImageHoverCg.png" width="481" />

&nbsp;

<img src="./images/screenshots/ImageHoverSprite.png" width="249" />

### 🔎 Navigation & Code Intelligence

#### Go to Symbol (`Cmd+Shift+O` / `Ctrl+Shift+O`)

<img src="./images/screenshots/JumpToLabel.png" width="607" />

Jump to:

* Labels (including local labels like `.label`)
* Screens
* Transforms
* Images
* Styles, defines, defaults, layeredimages

#### Workspace Symbol Search (`Cmd+T` / `Ctrl+T`)

<img src="./images/screenshots/WorkspaceSymbolSearch.png" width="601" />

Search across all `.rpy` files:

* Labels, screens, images
* Python functions and classes

#### Go to Definition (`F12`)

<img src="./images/screenshots/JumpToDefinition.png" width="670" />

Navigate directly to definitions of:

* Labels (`jump`, `call`)
* Screens (`show screen`, `call screen`, `use`)
* Images (`show`, `scene`, `hide`)
* Transforms and variables

✔ Handles Ren’Py’s flexible image naming (space-separated names)

### 🔁 Refactoring Tools

#### Find All References (`Shift+F12`)

* Locate all usages of labels, screens, images, and variables

#### Rename Symbol (`F2`)

* Rename labels, screens, and variables
* Automatically updates all references across the workspace

### ⚡ Intelligent Completions

<img src="./images/screenshots/BuiltinAutocompletion.png" width="856" />

&nbsp;

<img src="./images/screenshots/CustomAutocompletion.png" width="329" />

Context-aware suggestions for:

* Ren’Py keywords and statements (eg. `config.`, `gui.`, or `build.`)
* ATL syntax
* Transform and style properties
* Screen properties and `style_prefix` values
* Transitions (after `with`)
* Labels and screens in relevant contexts
* Built-in Ren’Py API

### ✍️ Signature Help

Inline parameter hints for 60+ functions, including:

* Transitions: `Dissolve()`, `Fade()`, `ImageDissolve()`
* Displayables: `Character()`, `Transform()`, `Text()`
* Actions: `Jump()`, `Call()`, `SetVariable()`
* `renpy.*` APIs (`renpy.pause()`, `renpy.show()`, etc.)
* Audio APIs: `renpy.music.*`, `renpy.sound.*`
* Image tools: `im.Composite()`, `LiveComposite()`

### ⚠️ Diagnostics

<img src="./images/screenshots/InvalidAsset.png" width="450" />

Real-time feedback with:

**Warnings**

* Undefined labels (`jump`, `call`)
* Undefined local labels (`.label`)
* Missing screens (`call screen`, `show screen`, `use`)

**Errors**

* Mismatched quotes (including triple-quoted strings)

## 🛠 Development

```bash
git clone https://github.com/adiffx/renpy-magic.git
cd renpy-magic
npm install
npm run compile
```

Then press `F5` in VS Code to launch the Extension Development Host.

### Running Tests

```bash
npm test
```

### Updating API Data

```bash
npm run fetch-api
npm run compile
```

This pulls documentation from Ren’Py source and RST files, generating:

```
src/server/renpy-api.json
```

## ⚙️ Settings

| Setting | Default | Description |
| ------- | ------- | ----------- |
| `renpyMagic.diagnostics.warnUndefinedImages` | `false` | Warn when `show`/`scene` references an image not defined in code. Disabled by default because images are often defined as files rather than in code. |

## ⚠️ Known Limitations

* Embedded Python does not use a full Python language server
* Image validation only covers code-defined images (enable `warnUndefinedImages` to check)
* Local labels are validated per file (not across files)

## 📋 Requirements

* VS Code **1.75.0+**
* No external runtime dependencies (pure TypeScript implementation)

## 📄 License

MIT
