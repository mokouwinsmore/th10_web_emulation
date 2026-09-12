# TH08 上游性能更新核对（2026-09-10）

本轮为只读源码/证据审阅，没有修改运行时代码，也没有重新运行上游游戏或手机测试。目标是确认同一上游包中 TH08 的优化是否被此前 TH10 工作遗漏。

## 包与证据身份

- 来源：`D:/workspace/东方测试.zip/东方测试 (1).zip`，4,347,558,812 字节。只读取中央目录和明确选定成员，未全量解压或计算整个压缩包的哈希。
- TH08 版本 1.0.5，构建时间 `2026-09-09T09:20:03.366Z`；原版 TH08 1.00d x86 经 v86 WebAssembly 执行。
- 当前有效代码在 `scripts/native/`，发布代码在 `dist/runtime/`。旧 `src/` 不属于这个版本的实际启动链。
- 26 个源模块均匹配 BUILD.json SHA-256，且与实际 dist/runtime 文件逐字节一致。
- 两游戏包内 v86.js 和 v86.wasm 的 SHA-256 分别完全一致；此项仅显式读取四个文件，共 4,922,210 字节。没有 TH08 独享的新 v86 核心。
- TH08 的 machine、jit-machine、dsound、audio-bridge、audio-mixer 与已提取的 TH10 上游版本逐字节一致。

## 上游性能证据的边界

1.0.5 减少几何提交临时分配并优化宿主接口返回。隔离基准中，重复 600 次提交的中位耗时 88.289 → 55.309 ms，提交字节摘要相同；两款渲染器使用的是同一份 TH10 几何样本。这不是整帧或手机加速比例。

实际 TH08 的两轮新旧对照未显示稳定整帧改善：第一轮 p99 27.3 → 29.1 ms，第二轮 25.5 → 24.8 ms。最终版本另一次运行仍有 77.5 ms 长帧。上游自己也明确否认已经完全不掉帧。

1.0.4 的组合改动包含音乐预读、寄存器视图复用、shader 预热、移除逐帧 getError 和绘图状态复用。其历史记录音乐等待 80 → 0；这不能单独证明 CPU 持续高占用由音乐引起，也不能把组合测试收益归因给单个改动。

以上性能数字来自包内历史文档与 JSON，本轮只核对记录，没有重跑这些上游实验。

审阅原始证据：`artifacts/validation/th08-upstream-review-20260910/`，包括 audit.json、supplement-audit.json、identity.json、dist-identity.json、v86-identity.json 与选定原始文件。源文档为 README.md 和 docs/FRAME-STABILITY.md；历史测量为 artifacts/native/frame-stability-1.0.5.json 与 frame-stability-validation.json。

## 与当前 TH10 的差距及决策

| 项目 | 当前 TH10 状态 | 决策 |
| --- | --- | --- |
| JIT 内存视图复用、宿主返回快路径 | 已有；本地返回还保留诊断回退 | 保留当前实现，不用 TH08 文件覆盖 |
| shader 预热、逐帧 getError 移除、几何 staging | 已有对应实现 | 未发现可直接补入的 TH08 独有提交优化 |
| 状态共享后复制 | 两者都有；TH10 另有矩阵/viewport/scissor 按字节去重 | 当前 TH10 在这点多做一步；不要误读为 TH10 缺少 TH08 COW |
| 音乐入口/循环点预载、后续块预取、请求去重 | 当前 PagedMusic 仍按需读块，未接入上游预读 | 确认遗漏；可作为 I/O 长帧候选，不能直接解释持续 CPU 高占用 |
| 原版 CRT malloc/free/calloc 宿主替代 | TH08 固定地址替代；TH10 只有导入 API 分配服务 | 确认实现差异；先定位 TH10 实际调用和热点，禁止照搬地址 |
| D3DX/文字格式特化 | 两游戏均有各自快路径；地址、DLL、格式不同 | 没有证据证明 TH08 文字路径是 TH10 缺陷，不能按名字缺失判定遗漏 |

关键代码证据（路径相对项目）：

- TH08 `source/th08_web/scripts/native/win32.mjs:17-22`（位于审阅 evidence 目录）：三个固定 CRT 地址进入宿主 alloc/free；当前 `runtime/win32.mjs:17-18,50` 已有相同类别分配器和导入 API，但没有这些内部 CRT 替代。应区分已有分配服务与尚未建立的内部调用快路径。没有旧版 TH08 对照，不能声称该替代是 1.0.5 新增。
- TH08 `assets.mjs:7-68` 与 `browser-worker.js:15-16`：预读实现及启动接线。当前 `runtime/assets.mjs:6-9` 为按需读取。TH10 上游已提取的 assets 中也有同类预读，因而它不是 TH08 独有；上次未提取 music-layout 不等于完整压缩包缺少该文件。
- TH08 `d3d8.mjs:5,42-43,91` 的 COW 与 `webgl.mjs:62-82` 的 staging；当前 `runtime/d3d9.mjs:9-13,63-64` 为额外快照去重。
- TH08 `d3dx-filter.mjs:7-43` 是固定地址的解码、累积、编码替代。当前 `runtime/d3dx-fast.mjs:5-118` 已有 TH10 D3DX9_31 的 FilterTable、行转换、FilterRGBA、ClampRGBA 与精度回退；`runtime/browser-worker.js:74-76,100` 实际装载 DLL、安装并预热。不能因为缺少 installTextAlpha 同名入口就判断 TH10 没有文字加速。

音乐预读上游策略约需 49 MiB 常驻入口缓存加 16 MiB 滚动缓存。移植前要保留现有 dataBuffer/musicSource、外部音乐 URL/Range 路径和内存边界，按 TH10 曲目布局生成提示。当前本地优化基准的 I/O 等待已为零，因此不能用这一补项承诺该场景 CPU 收益。

针对用户提出的渲染导致高 CPU 的判断，下一步优先测量宿主绘图调用与模拟 DLL/CRT 各自占比，确认内部 CRT 分配是否在密集 Demo 热路径，再决定是否替代；音乐预读另作存在 I/O 等待时的优化。现有证据支持继续查 CPU 侧绘图/模拟边界，尚不足以定根因。

本次由两个 Luna xhigh 只读 Scout 分别主动调查 CPU/音频和渲染，主线程核对身份与决定结论，并抽查关键代码。没有新运行时变更；此前本地性能和功能测试结论仍见 MOBILE_PERFORMANCE_2026-09-10.md，不能视为本轮新增验收。


## 后续应用状态

用户随后授权尝试应用。音乐预读已进入本地 th10-perf-5，测试、40.5 MiB 入口缓存代价与证据范围见 MOBILE_PERFORMANCE_2026-09-10.md 的追加章节。CRT 内部替代仍缺少版本绑定的地址/ABI 证据；已检查实际 TH10 EXE 的导入表，不能借用 TH08 地址。以上更新取代前文音乐预读尚未接入的历史状态。
