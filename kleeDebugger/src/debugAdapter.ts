import { DebugSession, InitializedEvent, TerminatedEvent, OutputEvent, LoggingDebugSession } from 'vscode-debugadapter';
import { DebugProtocol } from 'vscode-debugprotocol';
import { spawn, ChildProcess } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { Subject } from './object';

// 自定义 LaunchRequestArguments，包含 program 属性
interface LaunchRequestArguments extends DebugProtocol.LaunchRequestArguments {
    /** An absolute path to the "program" to debug. */
    program: string;
    /** Automatically stop target after launch. If not specified, target does not stop. */
    stopOnEntry?: boolean;
}

// 定义 MyDebugSession 类
class MyDebugSession extends LoggingDebugSession {

    private static threadID = 1;

    private sourceFileContent: string | undefined;

    private _configurationDone = new Subject();

    private breakpoints: { [file: string]: number[] } = {};

    private verifiedBreakpoints: DebugProtocol.Breakpoint[] = [];

    private process: ChildProcess | undefined;

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
            this.runKLEE(bcFilePath, response);
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

    runKLEE(bcFilePath: string, response: DebugProtocol.LaunchResponse): void {
        this.sendEvent(new OutputEvent(`Running KLEE with .bc file: ${bcFilePath}\n`));

        this.process = spawn('/home/klee/workdir/build/bin/klee', ['-debug-print-instructions=all:stderr', bcFilePath], {
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

        if (this.process.stdout) {
            this.process.stdout.on('data', (data) => {
                this.sendEvent(new OutputEvent(`KLEE stdout: ${data.toString()}\n`));
            });
        }

        if (this.process.stderr) {
            this.process.stderr.on('data', (data) => {
                this.sendEvent(new OutputEvent(`KLEE stderr: ${data.toString()}\n`));
            });
        }

        this.process.on('exit', (code) => {
            this.sendEvent(new OutputEvent(`KLEE process exited with code: ${code}\n`));
            this.sendEvent(new TerminatedEvent());
            this.sendResponse(response); // 在进程结束时发送响应
        });
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
        this.verifiedBreakpoints = breakpoints.filter(bp => bp.verified);
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
            // 如果有有效断点，提取路径和行号
            const path = verifiedBreakpoints[0].source!.path; // 假设所有断点都在同一个文件
            const verifiedLines = verifiedBreakpoints.map(bp => bp.line);

            const message = {
                type: "breakpoint",
                data: {
                    path: path,
                    lines: verifiedLines
                }
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
            const emptyMessage = JSON.stringify({
                type: "breakpoint",
                data: {
                    path: "",
                    lines: []
                }
            });
            if (this.process && this.process.stdin) {
                this.process.stdin.write(`${emptyMessage}\n`);
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

        return lineContent.length > 0 && !lineContent.startsWith('//');
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