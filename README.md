# TH10 Web

## 作者

作者：[@SteinsGateON](https://space.bilibili.com/34714121) · [B站空间](https://space.bilibili.com/34714121)

![作者 @SteinsGateON 的B站空间](docs/images/author-bilibili.png)

## 项目简介

在桌面浏览器中执行《东方风神录》1.00a日文或现成简体程序的兼容运行时。原x86程序负责游戏流程、关卡、弹幕、判定、计分与录像；JavaScript负责浏览器平台适配，v86/WASM负责CPU执行。

本项目与TH08 Web分别维护、分别发布。当前整理基于TH10 Web 1.0.1快照，保留原实现文件及其相对路径，新增项目说明和开源准备材料。源码目录不附游戏、汉化数据、字体或微软DLL；这些输入需要使用者自行准备。

## 如何运行

如果已有完整dist，在项目目录运行：

```powershell
node scripts/serve.mjs --dist --port 8090
```

打开[本地游戏页面](http://127.0.0.1:8090)，选择日文或简体版，再点击「开始游戏」。完整原本地包附Windows启动脚本和Node.js；这个源码目录不附便携Node或dist，不能直接按完整包启动。

浏览器需要WebAssembly、WebGL2、OffscreenCanvas和AudioWorklet，请通过localhost或HTTPS访问，开启硬件加速，不要直接打开HTML文件。手机触摸控制尚未实现。

## 操作与保存

| 操作 | 按键 |
| --- | --- |
| 移动、菜单选择 | 方向键 |
| 射击、确认 | Z |
| 灵击、返回 | X |
| 低速 | Shift |
| 暂停 | Esc |
| 快进对话 | Ctrl |

日文与简体版分别使用自己的EXE和DAT，并分别保存进度；共用原始BGM。浏览器IndexedDB保存原程序产生的配置、成绩和回放，页面支持原版文件导入及JSON备份。

结束游玩时点击「退出并保存」，等待游戏退出。更换浏览器、端口或清理站点数据前先导出备份，恢复时选择对应语言。手柄接入原版输入接口，实际设备支持仍应单独验证。

## 实现结构

```text
网页输入与存档界面
  └─ Worker：v86/WASM、原版EXE
       ├─ Win32/COM、guest线程、时间和虚拟文件
       ├─ D3D9 → WebGL2 / OffscreenCanvas
       ├─ guest内D3DX9_31 DLL + 有条件的计算加速
       ├─ CP932/CP936、GDI字形缓存
       └─ DirectSound → AudioWorklet、分块原始PCM音乐
```

运行时不是完整Windows。原EXE执行游戏语义，但会安装LZSS、D3DX文字计算及透明边缘加速，并做文字预热；因此不能称所有guest指令原样执行。图形与声音的浏览器最终输出也不因运行原程序而自动获得全场景等价证明。

| 文件 | 职责 |
| --- | --- |
| [index.html](index.html) / [browser-main.mjs](runtime/browser-main.mjs) | 页面、输入和备份操作 |
| [browser-worker.js](runtime/browser-worker.js) | 语言资源选择、CPU及兼容层启动 |
| [jit-machine.mjs](runtime/jit-machine.mjs) / [scheduler.mjs](runtime/scheduler.mjs) | CPU执行、上下文、线程与时间 |
| [library.mjs](runtime/library.mjs) | D3DX DLL重定位、导入和导出 |
| [d3d9.mjs](runtime/d3d9.mjs) / [webgl.mjs](runtime/webgl.mjs) | D3D9适配与绘制 |
| [d3dx-fast.mjs](runtime/d3dx-fast.mjs) | 文字计算加速、条件检查和回退 |
| [storage.mjs](runtime/storage.mjs) | 分语言持久化 |

runtime目录包含26个生产模块；scripts中另有构建、服务和诊断工具。两个历史一次性生成器仍引用TH08文件；本次原样保留并说明该依赖，不为独立开源而删去来源链。它们不属于正式启动链，生成后的D3D9Oracle.cs及render-fixtures.mjs已在本项目中。

## 从源码准备构建

现有脚本读取项目旁的`[th10] 东方风神录 (汉化版+日文版)`目录。日文输入为th10.exe与th10.dat，简体输入为th10chs.exe与th10c.dat，共用thbgm.dat。还需要合法自备的D3DX9_31 DLL、Windows生成的MS Gothic/SimHei字形缓存和指定v86 vendor文件。

输入齐备后，现有入口为：

```powershell
npm run build
npm start
# 直接读取原始输入的开发服务，端口8091：
npm run dev
```

当前快照没有package-lock，vendor与字体生成也有本机前提。因此上述命令不是从空目录一键完成构建的承诺。需要补充的依赖锁定、资源配置和输入校验先记录在发布清单中，原build脚本保持原样。旧package.py打包的是包含游戏数据的本地游玩包，不能直接用于源码发行。

## 验证范围

`npm test`含原游戏、DLL及Windows GDI对照；部分浏览器探针还依赖外部全开档，未附带。这些测试应与未来的自造输入公开CI分开记录。

2026-09-09对完整本地构建检查了日文/简体两个入口，均进入第一关并显示暂停画面，记录了出帧和音频指标。原测试1通过、10失败，主要缺相邻原版目录，另有日文和简体两组GDI像素差异。没有重新验证全部关卡或真人操作体验。

历史结果见[VALIDATION.md](docs/VALIDATION.md)。其中六关等长程探针包含补命、补火力或关闭绘制；机体/难度是组合抽样，Extra运行帧数也不等于通关断言。不能将这些材料改述为无辅助浏览器全流程通过。

## 源文件与开源准备

本次README重新撰写，历史说明通过[源文件引用](README.snapshot.md)定位。原实现、测试、配置和来源文档保留原字节；外部发布清单负责挑选可公开材料，不通过改写源文件掩盖依赖问题。

本项目代码采用 [MIT License](LICENSE)，版权署名为 SteinsGateON。汉化、微软DLL、字体和其他第三方内容保留各自权利，不由本项目MIT许可证授权。参见[来源说明](THIRD_PARTY_NOTICES.md)、[后续清单](RELEASE_CHECKLIST.md)和[贡献约定](CONTRIBUTING.md)。TH10独立维护仓库和版本，不沿用TH08的验收结论。
