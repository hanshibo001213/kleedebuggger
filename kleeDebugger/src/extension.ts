// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as path from 'path';
import { ProviderResult } from 'vscode';
import { activateKleeDebug } from './activateKleeDebug';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	console.log("Plugin activated!");
	// 在 VSCode 输出面板显示调试器适配器的消息
	const kleeChannel = vscode.window.createOutputChannel('Debugger Adapter');
	kleeChannel.appendLine('插件启动成功');
	kleeChannel.show();

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
			const command = "python";
			const args = [path.join('/home/klee/kleeDebugger', 'src', 'test.py')];
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