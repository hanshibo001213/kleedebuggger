import { DebugSession, InitializedEvent, TerminatedEvent, StoppedEvent, OutputEvent, Event, LoggingDebugSession, Thread, StackFrame, Source } from 'vscode-debugadapter';
import { DebugProtocol } from 'vscode-debugprotocol';
import { spawn, ChildProcess } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { Subject } from './object';
import * as path from 'path';

// 自定义 LaunchRequestArguments，包含 program 属性
interface LaunchRequestArguments extends DebugProtocol.LaunchRequestArguments {
    /** An absolute path to the "program" to debug. */
    program: string;
    /** Automatically stop target after launch. If not specified, target does not stop. */
    stopOnEntry?: boolean;
}

export class myStoppedEvent extends Event implements DebugProtocol.StoppedEvent {
    body: {
        reason: string;
        threadId?: number;
        sourceFilePath?: string;
        line?: number;
    };


    constructor(reason: string, threadId: number, sourceFilePath: string, line: number) {
        super(reason, threadId); // 调用父类构造函数
        this.body = {
            reason: reason,
            threadId: threadId,
            sourceFilePath: sourceFilePath,
            line: line
        };
    }
}


// 定义 MyDebugSession 类
class MyDebugSession extends LoggingDebugSession {

    private static threadID = 1;

    private sourceFileContent: string | undefined;

    private _configurationDone = new Subject();

    private breakpoints: { [file: string]: number[] } = {};

    private verifiedBreakpoints: DebugProtocol.Breakpoint[] = [];

    private process: ChildProcess | undefined;

    private stdoutBuffer = ""; // ✅ 这里定义

    private callStack: StackFrame[] = [];


    // 构造函数
    constructor() {
        super();  // 调用父类 DebugSession 的构造函数
        this.sendEvent(new OutputEvent('MyDebugSession实例化成功'));  // 类实例化成功
        // 配置行和列的编号从 0 开始
        this.setDebuggerLinesStartAt1(false);
        this.setDebuggerColumnsStartAt1(false);
    }

    // 在初始化请求时输出日志到调试控制台
    protected initializeRequest(response: DebugProtocol.InitializeResponse, args: DebugProtocol.InitializeRequestArguments): void {
        // build and return the capabilities of this debug adapter:
        response.body = response.body || {};

        // the adapter implements the configurationDone request.
        response.body.supportsConfigurationDoneRequest = true;

        // 使用 OutputEvent 向调试控制台发送消息
        this.sendEvent(new OutputEvent('调试适配器已启动\n'));
        this.sendResponse(response);
        this.sendEvent(new InitializedEvent());
    }

    /**
     * Called at the end of the configuration sequence.
     * Indicates that all breakpoints etc. have been sent to the DA and that the 'launch' can start.
     */
    protected configurationDoneRequest(response: DebugProtocol.ConfigurationDoneResponse, args: DebugProtocol.ConfigurationDoneArguments): void {
        this.sendEvent(new OutputEvent("Configuration done request received.\n"));
        super.configurationDoneRequest(response, args);

        // notify the launchRequest that configuration has finished
        this._configurationDone.notify();
    }

    protected async launchRequest(response: DebugProtocol.LaunchResponse, args: LaunchRequestArguments): Promise<void> {
        this.sendEvent(new OutputEvent("Launching request...\n"));

        // wait 1 second until configuration has finished (and configurationDoneRequest has been called)
        await this._configurationDone.wait(1000);
        this.sendEvent(new OutputEvent("Configuration done, proceeding with launch...\n"));
        // 使用 sendEvent 输出 args 参数，检查是否正确传递
        this.sendEvent(new OutputEvent(`Launch arguments: ${JSON.stringify(args, null, 2)}\n`));

        const sourceFilePath = args.program;

        // 检查是否传入了 C 文件路径
        if (!sourceFilePath) {
            this.sendEvent(new OutputEvent("没有打开C文件或未指定文件路径\n"));
            this.sendResponse(response);
            return;
        }

        // 输出文件路径
        this.sendEvent(new OutputEvent(`被调试的文件: ${sourceFilePath}\n`));

        // Step 1: Compile C source to .bc file
        const bcFilePath = sourceFilePath.replace('.c', '.bc');
        this.sendEvent(new OutputEvent(`Compiling to .bc: ${bcFilePath}\n`));

        this.compileSourceFile(sourceFilePath, bcFilePath, () => {
            this.sendEvent(new OutputEvent("Compilation finished.\n"));

            // Step 2: Run KLEE with the generated .bc file after successful compilation
            this.runKLEE(sourceFilePath, bcFilePath, response);
        });

        // 确保最终调用 sendResponse
        this.sendResponse(response);  // 重要：确保发送响应，结束 launchRequest
    }
    compileSourceFile(sourceFilePath: string, bcFilePath: string, callback: () => void): void {
        this.sendEvent(new OutputEvent(`Compiling source file: ${sourceFilePath}\n`));

        const compileProcess = spawn('clang', ['-g', '-emit-llvm', '-c', sourceFilePath, '-o', bcFilePath]);

        compileProcess.stderr.on('data', (data) => {
            this.sendEvent(new OutputEvent(`编译错误: ${data}\n`));
        });

        compileProcess.on('close', (code) => {
            if (code !== 0) {
                this.sendEvent(new OutputEvent("Failed to compile source file.\n"));
                return;
            }
            this.sendEvent(new OutputEvent("Compilation successful.\n"));
            callback();
        });
    }

    runKLEE(sourceFilePath: string, bcFilePath: string, response: DebugProtocol.LaunchResponse): void {
        this.sendEvent(new OutputEvent(`Running KLEE with .bc file: ${bcFilePath}\n`));

        this.process = spawn('/home/klee/workdir/build/bin/klee', ['-debug-print-instructions=all:file', bcFilePath], {
            stdio: ['pipe', 'pipe', 'pipe'],
            shell: true,
            env: process.env
        });

        if (!this.process) {
            this.sendEvent(new OutputEvent("KLEE process failed to start.\n"));
            this.sendResponse(response); // 如果进程不存在，发送响应并返回
            return;
        }

        // 在启动工具进程后立即发送断点信息
        this.sendBreakpointsToTool(this.verifiedBreakpoints);

        // if (this.process.stdout) {
        //     this.process.stdout.on('data', (data) => {
        //         const output = data.toString();
        //         this.sendEvent(new OutputEvent(`KLEE stdout: ${output}\n`));
        //         if (output.includes("Covered new line")) {
        //             // 匹配覆盖的行号和文件路径
        //             const coverageMatch = output.match(/Covered new line: (\d+) in file: (.+)/);
        //             if (coverageMatch) {
        //                 const coveredLineNumber = parseInt(coverageMatch[1], 10);
        //                 const filePath = coverageMatch[2].trim();

        //                 this.sendEvent(new OutputEvent(`覆盖行: 文件 ${filePath}, 行号 ${coveredLineNumber}\n`));

        //                 // 发送覆盖行的高亮事件
        //                 this.sendEvent(new Event('coverageHighlight', {
        //                     sourceFilePath: filePath,
        //                     line: coveredLineNumber
        //                 }));
        //             }
        //         }
        //         // else if (output.includes("Hit breakpoint")) {

        //         //     // 检查输出是否包含断点命中的信息，并提取行号和文件路径
        //         //     const breakpointMatch = output.match(/Hit breakpoint at line: (\d+) in file: (.+)/);
        //         //     if (breakpointMatch) {
        //         //         // 提取行号和文件路径
        //         //         const breakpointLineNumber = parseInt(breakpointMatch[1], 10);
        //         //         const filePath = breakpointMatch[2].trim();

        //         //         this.sendEvent(new OutputEvent(`断点命中: 文件 ${sourceFilePath}, 行号 ${breakpointLineNumber}\n`));

        //         //         // 创建一个合适的 Event
        //         //         this.sendEvent(new Event('highlight', {
        //         //             sourceFilePath: filePath,
        //         //             line: breakpointLineNumber
        //         //         }));
        //         //         this.sendEvent(new StoppedEvent('breakpoint', MyDebugSession.threadID));
        //         //     }
        //         // } else {

        //         //     const parsed = JSON.parse(output);

        //         //     switch (parsed.type) {
        //         //         // case "breakpoint": {
        //         //         //     const { file, line, callstack } = parsed;

        //         //         //     // this.callStack = callstack.map((frame: any, index: number) => new StackFrame(
        //         //         //     //     index,
        //         //         //     //     frame.func || '(anonymous)',
        //         //         //     //     new Source(path.basename(frame.file), frame.file),
        //         //         //     //     (frame.line || 1) - 1,
        //         //         //     //     0
        //         //         //     // ));

        //         //         //     this.sendEvent(new OutputEvent(`断点命中: 文件 ${file}, 行号 ${line}\n`));
        //         //         //     this.sendEvent(new Event('highlight', { sourceFilePath: file, line }));
        //         //         //     this.sendEvent(new StoppedEvent('breakpoint', MyDebugSession.threadID));
        //         //         //     break;
        //         //         // }
        //         //         case "jsontree": {

        //         //             // 使用 vscode-debugadapter 中的 Event 构建事件对象
        //         //             const customEvent = new Event('jsonTree', {
        //         //                 output: JSON.stringify(parsed.jsontree)
        //         //             });

        //         //             // 发送自定义事件到 extension.ts
        //         //             this.sendEvent(customEvent);
        //         //             break;
        //         //         }
        //         //     }
        //         // 其他所有输出均视为标准输出事件
        //         // this.sendEvent(new OutputEvent(`KLEE stdout: ${output}\n`));
        //         // } 
        //         else if (output.includes("constraints")) {

        //             // 使用 vscode-debugadapter 中的 Event 构建事件对象
        //             const customEvent = new Event('jsonTree', {
        //                 output: output
        //             });

        //             // 发送自定义事件到 extension.ts
        //             this.sendEvent(customEvent);
        //         }
        //         else if (output.includes("file")) {
        //             const parsed = JSON.parse(output);
        //             const { file, line } = parsed;
        //             this.sendEvent(new OutputEvent(`断点命中: 文件 ${file}, 行号 ${line}\n`));

        //             // 创建一个合适的 Event
        //             this.sendEvent(new Event('highlight', {
        //                 sourceFilePath: file,
        //                 line: line
        //             }));
        //             this.sendEvent(new StoppedEvent('breakpoint', MyDebugSession.threadID));
        //         }
        //         // else {
        //         //     this.callStack = callstack.map((frame: any, index: number) => new StackFrame(
        //         //         index,
        //         //         frame.func || '(anonymous)',
        //         //         new Source(path.basename(frame.file), frame.file),
        //         //         (frame.line || 1) - 1,
        //         //         0
        //         //     ));
        //         // }
        //     });
        // }

        if (this.process.stdout) {
            this.process.stdout.on('data', (data) => {
                this.stdoutBuffer += data.toString();

                let newlineIndex;
                while ((newlineIndex = this.stdoutBuffer.indexOf('\n')) !== -1) {
                    const line = this.stdoutBuffer.slice(0, newlineIndex).trim();
                    this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);

                    if (!line) continue;

                    // ✅ 输出所有 stdout 到终端面板
                    this.sendEvent(new OutputEvent(`KLEE stdout: ${line}\n`));
                    // ✅ 按内容进行处理
                    if (line.includes("Covered new line")) {
                        const match = line.match(/Covered new line: (\d+) in file: (.+)/);
                        if (match) {
                            const coveredLineNumber = parseInt(match[1], 10);
                            const filePath = match[2].trim();

                            this.sendEvent(new OutputEvent(`覆盖行: 文件 ${filePath}, 行号 ${coveredLineNumber}\n`));
                            this.sendEvent(new Event('coverageHighlight', {
                                sourceFilePath: filePath,
                                line: coveredLineNumber
                            }));
                        }
                    } else if (line.includes('"constraints"')) {
                        // 🎯 说明是执行树（jsonTree）
                        this.sendEvent(new Event('jsonTree', {
                            output: line
                        }));
                    } else if (line.includes('"file"') && line.includes('"line"')) {
                        const parsed = JSON.parse(line);
                        const { file, line: lineNumber, callstack } = parsed;
                        this.sendEvent(new OutputEvent(`断点命中: 文件 ${file}, 行号 ${lineNumber}\n`));
                        this.callStack = callstack
                            .slice()         // 拷贝数组
                            .reverse()       // 反转：当前执行帧排在前面
                            .map((frame: any, index: number) => new StackFrame(
                                index,
                                frame.func || '(anonymous)',
                                new Source(path.basename(frame.file), frame.file),
                                (frame.line || 1),
                                frame.column ?? 0
                            ));

                        this.sendEvent(new OutputEvent(`当前调用栈:\n${JSON.stringify(this.callStack, null, 2)}\n`));

                        this.sendEvent(new Event('highlight', {
                            sourceFilePath: file,
                            line: lineNumber
                        }));
                        this.sendEvent(new StoppedEvent('breakpoint', MyDebugSession.threadID));
                    }
                }
            });
        }

        if (this.process.stderr) {
            this.process.stderr.on('data', (data) => {
                const output = data.toString();

                // 使用 vscode-debugadapter 中的 Event 构建事件对象
                const customEvent = new Event('kleeErr', {
                    output: output
                });

                // 发送自定义事件到 extension.ts
                this.sendEvent(customEvent);
                // if (output.includes("output directory is")) {
                //     // 使用 vscode-debugadapter 中的 Event 构建事件对象
                //     const customEvent = new Event('outputDir', {
                //         output: output
                //     });

                //     // 发送自定义事件到 extension.ts
                //     this.sendEvent(customEvent);
                // }

                this.sendEvent(new OutputEvent(`KLEE stderr: ${output}\n`));
            });
        }

        this.process.on('exit', (code) => {
            this.sendEvent(new OutputEvent(`KLEE process exited with code: ${code}\n`));
            this.sendEvent(new TerminatedEvent());
            this.sendResponse(response); // 在进程结束时发送响应
        });
    }

    protected stackTraceRequest(
        response: DebugProtocol.StackTraceResponse,
        args: DebugProtocol.StackTraceArguments
    ): void {
        response.body = {
            stackFrames: this.callStack || [],
            totalFrames: this.callStack?.length || 0
        };
        this.sendResponse(response);
    }

    protected setBreakPointsRequest(
        response: DebugProtocol.SetBreakpointsResponse,
        args: DebugProtocol.SetBreakpointsArguments
    ): void {
        const path = args.source.path as string;
        if (!path || !existsSync(path)) {
            this.sendEvent(new OutputEvent("无效的文件路径，无法加载文件。\n"));
            this.sendResponse(response);
            return;
        }

        const clientLines = (args.breakpoints || []).map(bp => bp.line);
        this.sendEvent(new OutputEvent(`路径: ${path}\n`));
        // 获取源文件内容并存储到实例变量
        try {
            this.sourceFileContent = readFileSync(path, 'utf-8');
            this.sendEvent(new OutputEvent(`文件内容: ${this.sourceFileContent}\n`));
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : String(err);
            this.sendEvent(new OutputEvent(`读取文件失败: ${errorMessage}\n`));
            this.sendResponse(response); // 添加响应通知
            return;
        }

        const breakpoints = clientLines.map(line => {
            const verified = this.isValidBreakpoint(line); // 验证断点是否有效
            const bp: DebugProtocol.Breakpoint = {
                verified,
                source: { path },
                line
            };
            return bp;
        });

        // 只收集 verified 为 true 的断点
        // 遍历新断点，确保不重复添加
        breakpoints.filter(bp => bp.verified).forEach(newBreakpoint => {
            const exists = this.verifiedBreakpoints.some(bp =>
                bp.line === newBreakpoint.line &&
                bp.source?.path === newBreakpoint.source?.path
            );
            if (!exists) {
                this.verifiedBreakpoints.push(newBreakpoint);
            }
        });

        this.sendBreakpointsToTool(this.verifiedBreakpoints);

        // 发送响应，返回断点信息
        response.body = { breakpoints };
        this.sendResponse(response);

        // 输出断点设置情况到调试控制台
        const validLines = this.verifiedBreakpoints.map(bp => bp.line).join(', ');
        this.sendEvent(new OutputEvent(`Breakpoints set for ${path} at lines ${validLines}\n`));
    }

    // 向工具发送断点信息
    private sendBreakpointsToTool(verifiedBreakpoints: DebugProtocol.Breakpoint[]): void {
        if (verifiedBreakpoints.length > 0) {
            // 构建断点消息，按照文件路径分组行号
            const breakpointsByFile: { [key: string]: number[] } = {};

            verifiedBreakpoints.forEach(bp => {
                const filePath = bp.source?.path;
                const lineNumber = bp.line;

                if (filePath && lineNumber !== undefined) {
                    if (!breakpointsByFile[filePath]) {
                        breakpointsByFile[filePath] = [];
                    }
                    breakpointsByFile[filePath].push(lineNumber);
                }
            });

            // 构建一个整体的断点消息，包含所有文件和对应行号
            const message = {
                type: "breakpoint",
                data: breakpointsByFile
            };

            const formattedMessage = JSON.stringify(message);
            this.sendEvent(new OutputEvent(`准备发送断点消息给工具: ${formattedMessage}\n`));

            // 检查工具进程是否存在，并通过 stdin 发送断点信息
            if (this.process && this.process.stdin) {
                this.process.stdin.write(`${formattedMessage}\n`);
                this.sendEvent(new OutputEvent(`断点消息已发送到工具进程: ${formattedMessage}\n`));
            } else {
                this.sendEvent(new OutputEvent(`工具进程尚未启动，无法发送断点消息。\n`));
            }
        } else {
            // 没有有效断点，发送空信息保持工具不阻塞
            const emptyMessage = {
                type: "breakpoint",
                data: {}
            };
            const formattedMessage = JSON.stringify(emptyMessage);
            if (this.process && this.process.stdin) {
                this.process.stdin.write(`${formattedMessage}\n`);
                this.sendEvent(new OutputEvent(`空的断点消息已发送到工具进程。\n`));
            }
        }
    }

    // 检查断点是否有效的方法
    private isValidBreakpoint(line: number): boolean {
        if (!this.sourceFileContent) {
            this.sendEvent(new OutputEvent("源文件内容未加载，无法检查断点。\n"));
            return false;
        }

        const lines = this.sourceFileContent.split('\n');
        const lineContent = lines[line - 1]?.trim(); // 使用可选链防止行不存在的情况

        return lineContent.length > 0 && !lineContent.startsWith('//') && !lineContent.startsWith('/*');
    }

    protected threadsRequest(response: DebugProtocol.ThreadsResponse): void {
        // 只返回一个默认线程
        response.body = {
            threads: [
                new Thread(MyDebugSession.threadID, "Main Thread")  // 假设只处理一个线程
            ]
        };
        this.sendResponse(response);
    }

    protected continueRequest(response: DebugProtocol.ContinueResponse): void {
        // 假设调试器接受的命令为 `continue`
        const message = {
            type: "continue"
        };

        const formattedMessage = JSON.stringify(message);
        if (this.process && this.process.stdin) {
            this.process.stdin.write(`${formattedMessage}\n`);
            this.sendEvent(new OutputEvent(`continue消息已发送到工具进程。\n`));
        }
        // 创建一个合适的 Event
        this.sendEvent(new Event('clearhighlight'));
        this.sendResponse(response);
    }

    terminateRequest(response: DebugProtocol.TerminateResponse): void {
        this.sendEvent(new OutputEvent("Terminating KLEE process.\n"));

        if (this.process) {
            this.process.kill();
            this.process = undefined;
        }
        this.sendEvent(new TerminatedEvent());
        this.sendResponse(response);
    }
}

// 在全局启动 MyDebugSession 调试会话
console.log('准备启动 MyDebugSession...');
DebugSession.run(MyDebugSession);