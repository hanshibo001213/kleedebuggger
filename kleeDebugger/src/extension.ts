// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as path from 'path';
import { ProviderResult } from 'vscode';
import { activateKleeDebug } from './activateKleeDebug';
import * as fs from 'fs';

let kleeStdOut: string[] = [];
let kleeStdErr: string[] = [];
let outputDirectory: string = "";

let currentDecorationType: vscode.TextEditorDecorationType | undefined = undefined;

let coverageDecorations: Map<string, vscode.TextEditorDecorationType> = new Map();
let coveredLines: Map<string, Set<number>> = new Map();

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	console.log("Plugin activated!");
	const kleeChannel = vscode.window.createOutputChannel('Debugger Adapter');
	kleeChannel.appendLine('插件启动成功');
	kleeChannel.show();

	let panel: vscode.WebviewPanel | undefined = undefined;
	let isDisposing = false;
	let isNewPanelCreated = false; 

	let eventQueue: vscode.DebugSessionCustomEvent[] = [];
	let isProcessing = false;

	const kleeDiagnostics = vscode.languages.createDiagnosticCollection("klee");

	const createNewPanel = () => {
		panel = vscode.window.createWebviewPanel(
			'myWebview',
			'Tool Output',
			vscode.ViewColumn.One,
			{
				enableScripts: true,
				retainContextWhenHidden: true,
			}
		);

		const htmlPath = path.join(context.extensionPath, 'src', 'test2.html');
		panel.webview.html = fs.readFileSync(htmlPath, 'utf8');

		panel.onDidDispose(() => {
			panel = undefined;
			console.log('Webview disposed');
		});
	};
	context.subscriptions.push(
		vscode.debug.onDidStartDebugSession(async (session) => {
			console.log(`Debug session started: ${session.id}`);

			coveredLines.clear();
			kleeDiagnostics.clear();
			kleeStdOut = [];
			kleeStdErr = [];
			eventQueue = [];

			if (panel) {
				panel.dispose();
			}

			createNewPanel();
			isNewPanelCreated = true;
		})
	);

	context.subscriptions.push(
		vscode.debug.onDidTerminateDebugSession(async (session) => {
			kleeChannel.appendLine(`Debug session stopped: ${session.id}`);

			const ktestFiles = fs.readdirSync(outputDirectory) 
				.filter(file => file.endsWith('.ktest'))
				.map(file => path.join(outputDirectory, file)) 
				.join(' ');

			const ktestToolPath = path.join(context.extensionPath, '../workdir/build/bin', 'ktest-tool'); 

			if (ktestFiles.length > 0) {
				const ktestToolCommand = `${ktestToolPath} ${ktestFiles}`;

				const { exec } = require('child_process');
				exec(ktestToolCommand, (error: Error | null, stdout: string, stderr: string) => {
					if (error) {
						console.error(`Error executing command: ${error.message}`);
						return;
					}

					panel?.webview.postMessage({
						type: 'ktestOutput',
						content: stdout
					});
				});
			}

			const statsFile = fs.readdirSync(outputDirectory)
				.filter(file => file.endsWith('.stats'))
				.map(file => path.join(outputDirectory, file))
				.join(' ');

			const kleeStatsPath = path.join(context.extensionPath, '../workdir/build/bin', 'klee-stats');

			const kleeStatsCommand = `${kleeStatsPath} ${outputDirectory}`;

			const { exec } = require('child_process');
			exec(kleeStatsCommand, (error: Error | null, stdout: string, stderr: string) => {
				if (error) {
					console.error(`Error executing command: ${error.message}`);
					return;
				}

				panel?.webview.postMessage({
					type: 'kstatsOutput',
					content: stdout
				});
			});
		})
	);

	async function processQueue() {
		if (isProcessing) return;
		isProcessing = true;

		while (eventQueue.length > 0) {
			const event = eventQueue.shift();
			if (!event) continue;

			try {
				await handleEvent(event);
			} catch (err) {
				console.error("处理事件时出错:", err);
			}
		}

		isProcessing = false;
	}

	async function handleEvent(event: vscode.DebugSessionCustomEvent) {
		kleeChannel.appendLine(`📥 Received event: ${event.event}`);

		if (event.event === 'jsonTree') {
			if (!isNewPanelCreated) {
				console.warn("新的 Webview 还未创建，保留 `jsonTree` 事件，等待 `panel`");
				eventQueue.unshift(event); 
				return;
			}

			const output = event.body.output;
			kleeStdOut.push(output); 

			panel?.webview.postMessage({ type: 'jsonTree', content: output });
		}
		else if (event.event === 'kleeErr') {
			const output = event.body.output;
			kleeStdErr.push(output); 

			const match = output.match(/output directory is "([^"]+)"/);
			if (match && match[1]) {
				outputDirectory = match[1];
			}

			else if (output.includes("KLEE: ERROR")) {
				parseKleeStderr(output);
			}
		}
		else if (event.event === 'highlight') {
			const { sourceFilePath, line } = event.body;
			kleeChannel.appendLine(sourceFilePath);
			highlightCodeLine(sourceFilePath, line);
		}
		else if (event.event === 'clearhighlight') {
			clearDecorations();
		}
		else if (event.event === 'coverageHighlight') {
			const filePath = event.body.sourceFilePath;
			const line = event.body.line - 1;

			if (!coveredLines.has(filePath)) {
				coveredLines.set(filePath, new Set());
			}
			coveredLines.get(filePath)!.add(line);

			markLineAsCovered(filePath);
		}
	}

	function parseKleeStderr(output: string) {
		const diagnostics: { [filePath: string]: vscode.Diagnostic[] } = {};

		const regex = /KLEE: ERROR: ([^:]+):(\d+): (.+)/g;
		let match;

		while ((match = regex.exec(output)) !== null) {
			const file = match[1].trim(); 
			const line = parseInt(match[2], 10); 
			const message = match[3].trim(); 

			const diagnostic = new vscode.Diagnostic(
				new vscode.Range(new vscode.Position(line - 1, 0), new vscode.Position(line - 1, 100)),
				`[KLEE] ${message}`,
				vscode.DiagnosticSeverity.Error
			);

			if (!diagnostics[file]) {
				diagnostics[file] = [];
			}
			diagnostics[file].push(diagnostic);
		}

		Object.keys(diagnostics).forEach(file => {
			const uri = vscode.Uri.file(file);

			const existing = kleeDiagnostics.get(uri) || [];

			const merged = [...existing, ...diagnostics[file]];

			kleeDiagnostics.set(uri, merged);
		});

	};

	vscode.debug.onDidReceiveDebugSessionCustomEvent((event) => {
		eventQueue.push(event);
		setTimeout(processQueue, 0);
	});

	context.subscriptions.push(
		vscode.workspace.onDidOpenTextDocument(doc => {
			const filePath = doc.uri.fsPath;
			if (coveredLines.has(filePath)) {
				const lines = coveredLines.get(filePath)!;
				const editor = vscode.window.visibleTextEditors.find(e => e.document.uri.fsPath === filePath);
				if (editor) {
					const decoration = coverageDecorations.get(filePath);
					if (decoration) {
						const ranges = Array.from(lines).map(line => new vscode.Range(line, 0, line, 0));
						editor.setDecorations(decoration, ranges);
					}
				}
			}
		})
	);

	function highlightCodeLine(filePath: string, lineNumber: number) {
		vscode.workspace.openTextDocument(filePath).then((doc) => {
			vscode.window.showTextDocument(doc).then((editor) => {
				const position = new vscode.Position(lineNumber - 1, 0);

				if (currentDecorationType) {
					editor.setDecorations(currentDecorationType, []);
				}

				currentDecorationType = vscode.window.createTextEditorDecorationType({
					backgroundColor: 'rgba(255, 254, 187, 1)',
					isWholeLine: true,
					overviewRulerColor: 'rgb(255, 255, 1)',
					overviewRulerLane: vscode.OverviewRulerLane.Full,
				});

				editor.revealRange(new vscode.Range(position, position));

				editor.setDecorations(currentDecorationType, [new vscode.Range(position, position)]);
			});
		});
	}

	function clearDecorations() {
		vscode.window.visibleTextEditors.forEach((editor) => {
			if (currentDecorationType) {
				editor.setDecorations(currentDecorationType, []);
			}
		});
	}

	function highlightAllCoveredLines() {
		for (const [filePath, lines] of coveredLines.entries()) {
			markLineAsCovered(filePath);
		}
	}

	function markLineAsCovered(filePath: string) {
		vscode.workspace.openTextDocument(filePath).then((doc) => {
			vscode.window.showTextDocument(doc, { preview: false }).then((editor) => {

				if (!coveredLines.has(filePath)) return;
				const lines = Array.from(coveredLines.get(filePath)!);
				if (lines.length === 0) return;

				const position = new vscode.Position(lines[0], 0);
				editor.revealRange(new vscode.Range(position, position));

				let decoration = coverageDecorations.get(filePath);
				if (!decoration) {
					decoration = vscode.window.createTextEditorDecorationType({
						isWholeLine: true,
						borderWidth: '0 0 0 3px',
						borderStyle: 'solid',
						borderColor: 'rgba(0, 255, 0, 1)',
					});
					coverageDecorations.set(filePath, decoration);
				}

				const ranges = lines.map(line => new vscode.Range(line, 0, line, 0));

				editor.setDecorations(decoration, ranges);
			});
		});
	}

	activateKleeDebug(context, new DebugAdapterExecutableFactory(context));
}

// This method is called when your extension is deactivated
export function deactivate() {
	console.log('KLEE Debugger deactivated.');
}

class DebugAdapterExecutableFactory implements vscode.DebugAdapterDescriptorFactory {

	private _context: vscode.ExtensionContext;
	constructor(context: vscode.ExtensionContext) {
		this._context = context;
	}

	// The following use of a DebugAdapter factory shows how to control what debug adapter executable is used.
	// Since the code implements the default behavior, it is absolutely not neccessary and we show it here only for educational purpose.

	createDebugAdapterDescriptor(_session: vscode.DebugSession, executable: vscode.DebugAdapterExecutable | undefined): ProviderResult<vscode.DebugAdapterDescriptor> {
		// param "executable" contains the executable optionally specified in the package.json (if any)
		console.log(executable)
		// use the executable specified in the package.json if it exists or determine it based on some other information (e.g. the session)
		if (!executable) {
			const command = "node";
			const args = [path.join('/home/klee/kleeDebugger', 'src', 'debugAdapter.ts')];
			console.log('Adapter Path: ', path.join('/home/klee/kleeDebugger', 'out', 'debugAdapter.js'));

			executable = new vscode.DebugAdapterExecutable(command, args);
		}

		// make VS Code launch the DA executable
		return executable;
	}
}
