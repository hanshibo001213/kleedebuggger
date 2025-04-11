import * as vscode from 'vscode';
import { startDebugger } from './debuggerAdapter';
import { log } from 'console';

function activate(context: vscode.ExtensionContext): void {
	console.log("插件3已启动")
	// 注册 "Run and Debug" 命令
	let disposable = vscode.commands.registerCommand('extension.runAndDebug', () => {
		// 向调试器适配器发送启动请求
		startDebugger();

		// 在 VSCode 输出面板显示调试器适配器的消息
		const outputChannel = vscode.window.createOutputChannel('Debugger Adapter');
		outputChannel.appendLine('Debugger adapter started');
		outputChannel.show();
	});

	context.subscriptions.push(disposable);
}

export { activate };