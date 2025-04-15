<div align="center">

# 🛠️ kleeDebugger

**符号执行可视化调试工具**

</div>

### 📋 简介

本项目是一个基于 KLEE 的[符号执行](https://en.wikipedia.org/wiki/Symbolic_execution)可视化调试插件，集成于 [VS Code](https://code.visualstudio.com/) 开发环境，旨在为 C/C++ 程序提供更加直观、交互式的符号执行体验。

### 环境配置

- VS Code 1.93.0
- Docker
- WSL2

<!--
📦 安装方法
1. 克隆项目
```bash
git clone
cd
```
2. 安装依赖并编译插件
```bash
npm install
npm run compile
```
3. 在 VS Code 中打开并运行
```bash
code .
```
按 F5 启动插件开发调试环境

🧪 使用说明

安装并配置 KLEE 环境（建议使用官方 Docker 镜像或源码编译）；

在 VS Code 中打开 C 项目，设置 launch.json；

在源代码中设置断点，点击“启动符号调试”；

在调试界面中查看执行树、路径约束、栈信息与覆盖率。

### 📂 项目结构

kleeDebugger

 ├── out/ # 编译生成的 JS 文件（build 输出目录）
 
 ├── src/ # 插件核心源码
 
 │   ├── activateKleeDebug.ts # 初始化调试器适配器（激活调试流程）
 
│   ├── debugAdapter.ts # 实现 Debug Adapter Protocol 的通信逻辑
 
│   ├── extension.ts # 插件入口文件，注册命令、激活插件
 
│   ├── object.ts # 同步与状态管理相关的类/结构
 
│   └── webview.html # Web 前端页面（展示执行树、状态等）
 
klee # 后端集成的 KLEE 工具或相关逻辑

-->

### 参考资料

1.VS Code插件开发相关

🔗 [官方文档](https://code.visualstudio.com/api) 🔗 [官方提供的调试插件demo](https://github.com/microsoft/vscode-mock-debug) 🔗 [调试适配器协议](https://microsoft.github.io/debug-adapter-protocol/) 🔗 [tutorial1](https://vscode-docs.readthedocs.io/en/stable/extensions/debugging-extensions/)
 🔗 [tutorial2](https://www.cnblogs.com/liuxianan/p/vscode-plugin-overview.html)

2.github上优秀的调试插件仓库

🔗 [codelldb](https://github.com/vadimcn/codelldb) 🔗 [vscode-ruby](https://github.com/rubyide/vscode-ruby) 🔗 [vscode-elixir-ls](https://github.com/elixir-lsp/vscode-elixir-ls) 🔗 [local-lua-debugger-vscode](https://github.com/tomblind/local-lua-debugger-vscode) 🔗 [vscode-lrdb](https://github.com/satoren/vscode-lrdb)
