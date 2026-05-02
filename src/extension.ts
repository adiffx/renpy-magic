import * as path from 'path';
import * as vscode from 'vscode';
import { ExtensionContext } from 'vscode';
import {
	LanguageClient,
	LanguageClientOptions,
	ServerOptions,
	TransportKind
} from 'vscode-languageclient/node';

let client: LanguageClient;
const outputChannel = vscode.window.createOutputChannel("Ren'Py LSP");

export function activate(context: ExtensionContext) {
	outputChannel.appendLine("Activating Ren'Py Language Support...");
	// Path to the server module
	const serverModule = context.asAbsolutePath(path.join('out', 'server', 'server.js'));

	// Server options - run the server as a Node module
	const serverOptions: ServerOptions = {
		run: {
			module: serverModule,
			transport: TransportKind.ipc
		},
		debug: {
			module: serverModule,
			transport: TransportKind.ipc,
			options: {
				execArgv: ['--nolazy', '--inspect=6009']
			}
		}
	};

	// Client options
	const clientOptions: LanguageClientOptions = {
		// Register the server for Ren'Py files
		documentSelector: [
			{ scheme: 'file', language: 'renpy' }
		],
		synchronize: {
			// Watch for .rpy file changes and image/audio asset changes on disk
			// (asset changes affect what Ren'Py lint considers defined)
			fileEvents: [
				vscode.workspace.createFileSystemWatcher('**/*.{rpy,rpym}'),
				vscode.workspace.createFileSystemWatcher('**/game/**/*.{png,jpg,jpeg,webp,webm,mp4,ogv,avi,mkv}')
			],
			// Notify server when configuration changes
			configurationSection: 'renpyMagic'
		},
		middleware: {
			// Mark hover content as trusted so `command:` links (used by the
			// "Play in default app" action for videos) actually fire instead
			// of being stripped as untrusted.
			provideHover: async (document, position, token, next) => {
				const hover = await next(document, position, token);
				if (hover) {
					hover.contents = hover.contents.map((c) => {
						if (c instanceof vscode.MarkdownString) {
							c.isTrusted = true;
						}
						return c;
					});
				}
				return hover;
			}
		}
	};

	// Open a file URI with the OS's default handler. Used by hover links
	// for media types VS Code's built-in viewer can't play (e.g. .webm).
	context.subscriptions.push(
		vscode.commands.registerCommand('renpy.openExternal', async (uri: string) => {
			try {
				await vscode.env.openExternal(vscode.Uri.parse(uri));
			} catch (err) {
				vscode.window.showErrorMessage(`Failed to open ${uri}: ${err}`);
			}
		})
	);

	// Create and start the client
	client = new LanguageClient(
		'renpyLanguageServer',
		"Ren'Py Language Server",
		serverOptions,
		clientOptions
	);

	// Start the client (also starts the server)
	client.start().then(() => {
		outputChannel.appendLine("Language server started successfully!");
	}).catch((error) => {
		outputChannel.appendLine("Failed to start language server: " + error);
	});

	outputChannel.appendLine("Ren'Py Language Support is now active!");
}

export function deactivate(): Thenable<void> | undefined {
	if (!client) {
		return undefined;
	}
	return client.stop();
}
