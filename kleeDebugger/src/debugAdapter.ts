import { DebugSession, InitializedEvent, TerminatedEvent, StoppedEvent, OutputEvent, Event, LoggingDebugSession, Thread, StackFrame, Source } from 'vscode-debugadapter';
import { DebugProtocol } from 'vscode-debugprotocol';
import { spawn, ChildProcess } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { Subject } from './object';
import * as path from 'path';

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
        super(reason, threadId);
        this.body = {
            reason: reason,
            threadId: threadId,
            sourceFilePath: sourceFilePath,
            line: line
        };
    }
}

class MyDebugSession extends LoggingDebugSession {

    private static threadID = 1;

    private sourceFileContent: string | undefined;

    private _configurationDone = new Subject();

    private breakpoints: { [file: string]: number[] } = {};

    private verifiedBreakpoints: DebugProtocol.Breakpoint[] = [];

    private process: ChildProcess | undefined;

    private stdoutBuffer = ""; 

    private callStack: StackFrame[] = [];

    constructor() {
        super(); 
        this.sendEvent(new OutputEvent('MyDebugSession实例化成功'));  
        this.setDebuggerLinesStartAt1(false);
        this.setDebuggerColumnsStartAt1(false);
    }

    protected initializeRequest(response: DebugProtocol.InitializeResponse, args: DebugProtocol.InitializeRequestArguments): void {
        // build and return the capabilities of this debug adapter:
        response.body = response.body || {};

        // the adapter implements the configurationDone request.
        response.body.supportsConfigurationDoneRequest = true;

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
        this.sendEvent(new OutputEvent(`Launch arguments: ${JSON.stringify(args, null, 2)}\n`));

        const sourceFilePath = args.program;

        if (!sourceFilePath) {
            this.sendEvent(new OutputEvent("没有打开C文件或未指定文件路径\n"));
            this.sendResponse(response);
            return;
        }

        this.sendEvent(new OutputEvent(`被调试的文件: ${sourceFilePath}\n`));

        const bcFilePath = sourceFilePath.replace('.c', '.bc');
        this.sendEvent(new OutputEvent(`Compiling to .bc: ${bcFilePath}\n`));

        this.compileSourceFile(sourceFilePath, bcFilePath, () => {
            this.sendEvent(new OutputEvent("Compilation finished.\n"));

            this.runKLEE(sourceFilePath, bcFilePath, response);
        });

        this.sendResponse(response); 
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
            this.sendResponse(response);
            return;
        }

        this.sendBreakpointsToTool(this.verifiedBreakpoints);

        if (this.process.stdout) {
            this.process.stdout.on('data', (data) => {
                this.stdoutBuffer += data.toString();

                let newlineIndex;
                while ((newlineIndex = this.stdoutBuffer.indexOf('\n')) !== -1) {
                    const line = this.stdoutBuffer.slice(0, newlineIndex).trim();
                    this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);

                    if (!line) continue;

                    this.sendEvent(new OutputEvent(`KLEE stdout: ${line}\n`));
                    
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

                        this.sendEvent(new Event('jsonTree', {
                            output: line
                        }));
                    } else if (line.includes('"file"') && line.includes('"line"')) {
                        const parsed = JSON.parse(line);
                        const { file, line: lineNumber, callstack } = parsed;
                        this.sendEvent(new OutputEvent(`断点命中: 文件 ${file}, 行号 ${lineNumber}\n`));
                        this.callStack = callstack
                            .slice()
                            .reverse()
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

                const customEvent = new Event('kleeErr', {
                    output: output
                });

                this.sendEvent(customEvent);

                this.sendEvent(new OutputEvent(`KLEE stderr: ${output}\n`));
            });
        }

        this.process.on('exit', (code) => {
            this.sendEvent(new OutputEvent(`KLEE process exited with code: ${code}\n`));
            this.sendEvent(new TerminatedEvent());
            this.sendResponse(response); 
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

        try {
            this.sourceFileContent = readFileSync(path, 'utf-8');
            this.sendEvent(new OutputEvent(`文件内容: ${this.sourceFileContent}\n`));
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : String(err);
            this.sendEvent(new OutputEvent(`读取文件失败: ${errorMessage}\n`));
            this.sendResponse(response); 
            return;
        }

        const breakpoints = clientLines.map(line => {
            const verified = this.isValidBreakpoint(line); 
            const bp: DebugProtocol.Breakpoint = {
                verified,
                source: { path },
                line
            };
            return bp;
        });

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

        response.body = { breakpoints };
        this.sendResponse(response);

        const validLines = this.verifiedBreakpoints.map(bp => bp.line).join(', ');
        this.sendEvent(new OutputEvent(`Breakpoints set for ${path} at lines ${validLines}\n`));
    }

    private sendBreakpointsToTool(verifiedBreakpoints: DebugProtocol.Breakpoint[]): void {
        if (verifiedBreakpoints.length > 0) {

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

            const message = {
                type: "breakpoint",
                data: breakpointsByFile
            };

            const formattedMessage = JSON.stringify(message);
            this.sendEvent(new OutputEvent(`准备发送断点消息给工具: ${formattedMessage}\n`));

            if (this.process && this.process.stdin) {
                this.process.stdin.write(`${formattedMessage}\n`);
                this.sendEvent(new OutputEvent(`断点消息已发送到工具进程: ${formattedMessage}\n`));
            } else {
                this.sendEvent(new OutputEvent(`工具进程尚未启动，无法发送断点消息。\n`));
            }
        } else {
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

    private isValidBreakpoint(line: number): boolean {
        if (!this.sourceFileContent) {
            this.sendEvent(new OutputEvent("源文件内容未加载，无法检查断点。\n"));
            return false;
        }

        const lines = this.sourceFileContent.split('\n');
        const lineContent = lines[line - 1]?.trim(); 

        return lineContent.length > 0 && !lineContent.startsWith('//') && !lineContent.startsWith('/*');
    }

    protected threadsRequest(response: DebugProtocol.ThreadsResponse): void {
        response.body = {
            threads: [
                new Thread(MyDebugSession.threadID, "Main Thread")
            ]
        };
        this.sendResponse(response);
    }

    protected continueRequest(response: DebugProtocol.ContinueResponse): void {
        const message = {
            type: "continue"
        };

        const formattedMessage = JSON.stringify(message);
        if (this.process && this.process.stdin) {
            this.process.stdin.write(`${formattedMessage}\n`);
            this.sendEvent(new OutputEvent(`continue消息已发送到工具进程。\n`));
        }

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

console.log('准备启动 MyDebugSession...');
DebugSession.run(MyDebugSession);
