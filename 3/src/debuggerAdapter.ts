import * as net from 'net';
import { spawn, ChildProcess } from 'child_process';

// 启动工具并发送调试请求
function startDebugger(): void {

    // 启动工具的进程
    const toolProcess = spawn('/home/klee/workdir/build/bin/klee', ['/home/klee/workdir/examples/get_sign/get_sign.bc'], {
        cwd: '/home/klee/3',
        stdio: 'pipe',
        shell: true,
        env: process.env
    });

    console.log('klee已启动!!!');

    console.log('子进程执行的命令及参数：', toolProcess.spawnargs);

    // 监听子进程的启动事件
    toolProcess.on('spawn', () => {
        console.log('子进程已成功启动');
    });

    // 等待子进程启动完成
    toolProcess.on('error', (err) => {
        console.error('无法启动子进程:', err);
    });

    toolProcess.stdout.on('data', (data) => {
        console.log('子进程标准输出：', data.toString());
    });

    toolProcess.stderr.on('data', (data) => {
        console.error('子进程标准错误输出：', data.toString());
    });

    toolProcess.on('close', (code) => {
        console.log('子进程退出码：', code);
    });

    // 创建客户端套接字
    const clientSocket = new net.Socket();
    console.log('here');
    // 在延迟结束后尝试连接
    setTimeout(() => {
        // 连接服务器
        clientSocket.connect(8899, '127.0.0.1', () => {
            console.log('已连接到服务器');
        });
    }, 20000);

    clientSocket.on('error', (error: Error) => {
        console.error('连接失败:', error.message);
    });
    // // 创建与工具的连接
    // const socket: net.Socket = net.connect({ host: '127.0.0.1', port: 8899 }, () => {
    //     console.log('已连接到KLEE子进程');
    // });

    console.log('已连接klee!!!');

    // 监听来自工具的消息
    // socket.on('data', (data: Buffer) => {
    //     const message = JSON.parse(data.toString());

    //     // 处理工具发送的消息
    //     switch (message.type) {
    //         case 'debuggerReady':
    //             console.log('Tool is ready for debugging');
    //             break;
    //         // 其他消息处理逻辑...
    //     }
    // });

    // // 当工具的标准输出有数据时，发送给调试器适配器
    // if (toolProcess.stdout) {
    //     toolProcess.stdout.on('data', (data: Buffer) => {
    //         const message = { type: 'toolOutput', data: data.toString() };
    //         socket.write(JSON.stringify(message));
    //     });
    // }

    // // 当工具的标准错误有数据时，发送给调试器适配器
    // if (toolProcess.stderr) {
    //     toolProcess.stderr.on('data', (data: Buffer) => {
    //         const message = { type: 'toolError', data: data.toString() };
    //         socket.write(JSON.stringify(message));
    //     });
    // }

    // // 监听工具的退出事件，发送给调试器适配器
    // toolProcess.on('exit', (code: number) => {
    //     const message = { type: 'toolExit', code };
    //     socket.write(JSON.stringify(message));
    // });

    // 发送调试请求给工具
    // const message = { type: 'startDebugger' };
    // socket.write(JSON.stringify(message));
}
export { startDebugger };