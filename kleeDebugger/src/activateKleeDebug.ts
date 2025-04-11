'use strict';

import * as vscode from 'vscode';

export function activateKleeDebug(context: vscode.ExtensionContext, factory?: vscode.DebugAdapterDescriptorFactory) {

    context.subscriptions.push(
        vscode.commands.registerCommand('extension.klee-debug.runEditorContents', (resource: vscode.Uri) => {
            let targetResource = resource;
            if (!targetResource && vscode.window.activeTextEditor) {
                targetResource = vscode.window.activeTextEditor.document.uri;
            }
            if (targetResource) {
                vscode.debug.startDebugging(undefined, {
                    type: 'klee-debugger',
                    name: 'Run File',
                    request: 'launch',
                    program: targetResource.fsPath
                },
                    { noDebug: true }
                );
            }
        }),
        vscode.commands.registerCommand('extension.klee-debug.debugEditorContents', (resource: vscode.Uri) => {
            let targetResource = resource;
            if (!targetResource && vscode.window.activeTextEditor) {
                targetResource = vscode.window.activeTextEditor.document.uri;
            }
            if (targetResource) {
                vscode.debug.startDebugging(undefined, {
                    type: 'klee-debugger',
                    name: 'Debug File',
                    request: 'launch',
                    program: targetResource.fsPath,
                    stopOnEntry: true
                });
            }
        }),
    );

    // 注册动态调试配置提供器
    context.subscriptions.push(
        vscode.debug.registerDebugConfigurationProvider('klee-debugger', {
            provideDebugConfigurations(folder, token) {
                console.log("provideDebugConfigurations triggered");
                const activeFile = vscode.window.activeTextEditor?.document.fileName;
                console.log("Active File: ", activeFile);
                return [{
                    name: 'Launch Current File',
                    type: 'klee-debugger',
                    request: 'launch',
                    program: vscode.window.activeTextEditor?.document.fileName // 当前打开文件
                }];
            }
        })
    );

    console.log(process.cwd());
    context.subscriptions.push(vscode.debug.registerDebugAdapterDescriptorFactory('klee-debugger', factory!));
    console.log('KLEE Debugger activated and ready to use.');
}