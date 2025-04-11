// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as path from 'path';
import { ProviderResult } from 'vscode';
import { activateKleeDebug } from './activateKleeDebug';
import * as fs from 'fs';

let kleeStdOut: string[] = []; // 缓存klee的stdout
let kleeStdErr: string[] = []; // 缓存klee的stderr
let outputDirectory: string = ""; // 输出目录
// let panel: vscode.WebviewPanel | undefined; // 用于管理 Webview 的生命周期

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
	let isNewPanelCreated = false; // ✅ 标记是否创建了新的 panel

	let eventQueue: vscode.DebugSessionCustomEvent[] = []; // 事件队列
	let isProcessing = false; // 事件处理标志
	// 创建全局的 Diagnostic Collection
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

			// 每次新的调试会话开始时清空之前的覆盖行数据
			coveredLines.clear();
			kleeDiagnostics.clear();
			kleeStdOut = [];
			kleeStdErr = [];
			eventQueue = [];

			if (panel) {
				panel.dispose(); // 释放面板
			}

			createNewPanel(); // 创建新面板
			isNewPanelCreated = true;
		})
	);

	context.subscriptions.push(
		vscode.debug.onDidTerminateDebugSession(async (session) => {
			kleeChannel.appendLine(`Debug session stopped: ${session.id}`);

			// 调用 ktest-tool
			const ktestFiles = fs.readdirSync(outputDirectory) // 读取目录
				.filter(file => file.endsWith('.ktest')) // 过滤出 .ktest 文件
				.map(file => path.join(outputDirectory, file)) // 构建完整路径
				.join(' '); // 连接成字符串

			const ktestToolPath = path.join(context.extensionPath, '../workdir/build/bin', 'ktest-tool'); // 更新为实际的 ktest-tool 路径

			// 执行 ktest-tool
			if (ktestFiles.length > 0) {
				const ktestToolCommand = `${ktestToolPath} ${ktestFiles}`;
				// 执行命令的逻辑
				const { exec } = require('child_process');
				exec(ktestToolCommand, (error: Error | null, stdout: string, stderr: string) => {
					if (error) {
						console.error(`Error executing command: ${error.message}`);
						return;
					}
					// 发送标准输出到 Webview
					panel?.webview.postMessage({
						type: 'ktestOutput',
						content: stdout
					});
				});
			}

			// 调用 klee-stats
			const statsFile = fs.readdirSync(outputDirectory) // 读取目录
				.filter(file => file.endsWith('.stats')) // 过滤出 run.stats 文件
				.map(file => path.join(outputDirectory, file)) // 构建完整路径
				.join(' '); // 连接成字符串

			const kleeStatsPath = path.join(context.extensionPath, '../workdir/build/bin', 'klee-stats'); // 更新为实际的 klee-stats 路径

			// 执行 klee-stats
			const kleeStatsCommand = `${kleeStatsPath} ${outputDirectory}`;
			// 执行命令的逻辑
			const { exec } = require('child_process');
			exec(kleeStatsCommand, (error: Error | null, stdout: string, stderr: string) => {
				if (error) {
					console.error(`Error executing command: ${error.message}`);
					return;
				}
				// 发送标准输出到 Webview
				panel?.webview.postMessage({
					type: 'kstatsOutput',
					content: stdout
				});
			});
		})
	);

	// 监听来自调试会话的 stdout 输出
	// vscode.debug.onDidReceiveDebugSessionCustomEvent((event) => {
	// 	kleeChannel.appendLine(`Received event: ${event.event}`);
	// 	if (event.event === 'kleeOut') {
	// 		const output = event.body.output;
	// 		kleeStdOut.push(output); // 缓存输出

	// 		// 如果 Webview 已经打开，发送新的输出
	// 		panel?.webview.postMessage({
	// 			type: 'kleeOut',
	// 			content: output
	// 		});
	// 	}
	// 	else if (event.event === 'kleeErr') {
	// 		const output = event.body.output;
	// 		kleeStdErr.push(output); // 缓存输出
	// 		// 提取输出中的路径
	// 		const match = output.match(/output directory is "([^"]+)"/);
	// 		if (match && match[1]) {
	// 			outputDirectory = match[1]; // 提取的路径
	// 		}

	// 		// // 如果 Webview 已经打开，发送新的输出
	// 		// panel?.webview.postMessage({
	// 		// 	type: 'kleeErr',
	// 		// 	content: output
	// 		// });
	// 	}
	// 	else if (event.event === 'highlight') {
	// 		const { sourceFilePath, line } = event.body;
	// 		kleeChannel.appendLine(sourceFilePath);
	// 		highlightCodeLine(sourceFilePath, line);
	// 	}
	// 	else if (event.event === 'clearhighlight') {
	// 		// 执行继续操作时的清理操作
	// 		clearDecorations();
	// 	}
	// 	else if (event.event === 'coverageHighlight') {
	// 		const filePath = event.body.sourceFilePath;
	// 		const line = event.body.line - 1; // VSCode 行号从 0 开始

	// 		// ✅ 先确保 `coveredLines` 里有这个文件的 Set
	// 		if (!coveredLines.has(filePath)) {
	// 			coveredLines.set(filePath, new Set());
	// 		}

	// 		// ✅ 把新的行号加入 `Set<number>`，保证多行存储
	// 		coveredLines.get(filePath)!.add(line);

	// 		// // ✅ 重新高亮所有文件
	// 		// highlightAllCoveredLines();

	// 		markLineAsCovered("/home/test/get_sign.c");
	// 	}
	// });

	async function processQueue() {
		if (isProcessing) return; // 如果已经在处理，就不重复触发
		isProcessing = true;

		while (eventQueue.length > 0) {
			const event = eventQueue.shift(); // 取出队列中的第一个事件
			if (!event) continue;

			try {
				await handleEvent(event); // 处理事件
			} catch (err) {
				console.error("❌ 处理事件时出错:", err);
			}
		}

		isProcessing = false; // 事件处理完成
	}

	async function handleEvent(event: vscode.DebugSessionCustomEvent) {
		kleeChannel.appendLine(`📥 Received event: ${event.event}`);

		// ✅ 只有在 Webview `ready` 后，`jsonTree` 事件才会处理
		if (event.event === 'jsonTree') {
			if (!isNewPanelCreated) {
				console.warn("⚠️ 新的 Webview 还未创建，保留 `jsonTree` 事件，等待 `panel`");
				eventQueue.unshift(event); // ✅ 把未处理的事件放回队列的**最前面**
				return;
			}

			const output = event.body.output;
			kleeStdOut.push(output); // 缓存输出

			// ✅ 只向 Webview 准备好的 `panel` 发送消息
			panel?.webview.postMessage({ type: 'jsonTree', content: output });
		}
		else if (event.event === 'kleeErr') {
			const output = event.body.output;
			kleeStdErr.push(output); // 缓存输出

			// ✅ 解析 output 目录
			const match = output.match(/output directory is "([^"]+)"/);
			if (match && match[1]) {
				outputDirectory = match[1]; // 提取的路径
			}

			// ✅ 仅解析 KLEE 错误消息，不干扰其他输出
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

		// ✅ 只匹配 `KLEE: ERROR` 相关的错误信息
		const regex = /KLEE: ERROR: ([^:]+):(\d+): (.+)/g;
		let match;

		while ((match = regex.exec(output)) !== null) {
			const file = match[1].trim(); // 文件路径
			const line = parseInt(match[2], 10); // 代码行号
			const message = match[3].trim(); // 错误信息

			// ✅ 创建 VSCode 诊断信息
			const diagnostic = new vscode.Diagnostic(
				new vscode.Range(new vscode.Position(line - 1, 0), new vscode.Position(line - 1, 100)),
				`[KLEE] ${message}`,
				vscode.DiagnosticSeverity.Error
			);

			// ✅ 存储到 diagnostics
			if (!diagnostics[file]) {
				diagnostics[file] = [];
			}
			diagnostics[file].push(diagnostic);
		}

		// ✅ 更新 VSCode Problems 面板
		Object.keys(diagnostics).forEach(file => {
			const uri = vscode.Uri.file(file);

			// ✅ 获取已有 diagnostics（如果有）
			const existing = kleeDiagnostics.get(uri) || [];

			// ✅ 合并已有和新解析的 diagnostics
			const merged = [...existing, ...diagnostics[file]];

			// ✅ 设置回去，避免覆盖
			kleeDiagnostics.set(uri, merged);
		});

	};

	// 🔹 事件监听时，加入队列并执行队列处理
	vscode.debug.onDidReceiveDebugSessionCustomEvent((event) => {
		eventQueue.push(event); // 事件加入队列
		setTimeout(processQueue, 0); // 确保队列中的事件按顺序执行
	});

	// 监听文件打开事件，恢复上次的覆盖行
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
				const position = new vscode.Position(lineNumber - 1, 0); // 行号从 1 开始，vscode 的 Position 从 0 开始

				// 如果之前已有装饰器，先移除
				if (currentDecorationType) {
					editor.setDecorations(currentDecorationType, []); // 清除之前的装饰
				}

				// 设置文本编辑器装饰器类型，给该行添加高亮
				currentDecorationType = vscode.window.createTextEditorDecorationType({
					backgroundColor: 'rgba(255, 254, 187, 1)', // 背景色
					isWholeLine: true, // 高亮整行
					overviewRulerColor: 'rgb(255, 255, 1)', // 概述区域的颜色
					overviewRulerLane: vscode.OverviewRulerLane.Full, // 高亮整行
				});

				// 确保代码行可见
				editor.revealRange(new vscode.Range(position, position));

				// 高亮当前行
				editor.setDecorations(currentDecorationType, [new vscode.Range(position, position)]);
			});
		});
	}

	/**
 * 清除所有装饰
 */
	function clearDecorations() {
		// 清除所有装饰
		vscode.window.visibleTextEditors.forEach((editor) => {
			if (currentDecorationType) {
				editor.setDecorations(currentDecorationType, []); // 清除之前的装饰
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
			vscode.window.showTextDocument(doc, { preview: false }).then((editor) => { // ✅ 让 VSCode 强制打开文件
				// ✅ 确保 `coveredLines` 里有数据
				if (!coveredLines.has(filePath)) return;
				const lines = Array.from(coveredLines.get(filePath)!);
				if (lines.length === 0) return;

				// ✅ 先确保代码行可见（滚动到第一行覆盖的行）
				const position = new vscode.Position(lines[0], 0);
				editor.revealRange(new vscode.Range(position, position));

				// ✅ 设置 Gutter 绿色边框
				let decoration = coverageDecorations.get(filePath);
				if (!decoration) {
					decoration = vscode.window.createTextEditorDecorationType({
						isWholeLine: true,
						borderWidth: '0 0 0 3px', // ✅ 绿色左侧边框
						borderStyle: 'solid',
						borderColor: 'rgba(0, 255, 0, 1)',
					});
					coverageDecorations.set(filePath, decoration);
				}

				// ✅ 生成所有要高亮的行
				const ranges = lines.map(line => new vscode.Range(line, 0, line, 0));

				// ✅ 统一高亮所有覆盖行
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
			// const options = {
			// 	cwd: "working directory for executable",
			// 	env: { "envVariable": "some value" }
			// };
			executable = new vscode.DebugAdapterExecutable(command, args);
		}

		// make VS Code launch the DA executable
		return executable;
	}
}