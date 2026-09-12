# TH10 手机性能接手结果：th10-perf-4

手机约 22 FPS 的问题尚未完成真机复测。本轮确认渲染提交的局部开销下降，未证明整体流畅度显著改善；不能用这台桌面上的约 60 FPS 宣布手机问题解决。

## 本轮修改与已有工作

- 接手时工作树已经有 perf-3：uniform/FBO/纹理参数缓存、三角形和实例矩阵提交缓冲复用、shader 预热、逐帧 GL 错误查询门控。本轮保留并补测，不将这些代码算作本轮新实现。
- 新增 `JitMachine.ret` 数字参数/对齐栈的直接返回路径，复用一次 grow-safe CPU 视图。未对齐栈、非数字参数仍执行旧实现，完整 flags/x87、内存边界、导入桩与时序保持不变。
- Scout 主动追踪渲染链后，本轮另实现 D3D 矩阵、viewport、scissor 的精确字节快照复用；没有变化时保留对象身份，有变化时继续复制并保持 queued packet/state-block 不可变。
- 新增 `th10LegacyReturns=1` 诊断对照，更新实际运行标记为 `th10-perf-4`。
- 给现有性能脚本增加隔离 hosted 协议载体、固定逻辑帧配对、窗口外真实画面读回、稀疏异步 GPU query。隔离载体只按运行文件清单提供文件，不构建/监听整个启动器。
- `prepare-touch-hosted.mjs --runtime-only` 只更新小份 runtime 源码和文件身份清单，不重新读写 DATA、字体或 v86。先更新 4 个模块，随后同步 D3D 模块，共涉及 5 个运行模块；最后一次读取源文件 272567 字节，生成目录仍为 69 个运行文件。

## 上游审阅

来源为用户指定的 `D:\workspace\东方测试.zip\东方测试 (1).zip`，长度 4347558812 字节。先读 ZIP64 尾部记录确认 12720 项、中央目录 2168133 字节；首次 10000 项预算拒绝后，显式使用 13000 项/3 MiB 目录预算。没有整包哈希或解压。

本轮读取 5 个明确成员（总计 42289 字节），其中 webgl/jit/package 的 SHA-256 与已有 `upstream-audit-r1` 小份源码证据一致。

| 候选 | 依赖与语义 | 本地决定与验证 |
| --- | --- | --- |
| 提交缓冲复用 | 同步 bufferData 后复用宿主字节，不改顶点顺序或 GPU 存储策略 | 已在 dirty 树，本轮保留；三种 primitive、实例化、边界测试及像素配对 |
| Present 错误查询门控、预热 | 保留显式错误检查和 context-loss；减少同步查询 | 已在 dirty 树，本轮验证；旧提交开关也恢复原逐帧查询 |
| 直接 Win32 返回 | 仅更改 EAX/ESP/EIP 与 EIP cache invalidation，不换 v86 | 本轮采用；完整 CPU 上下文差分、memory.grow、异常边界与微基准 |
| 上游寄存器视图替换 | 与本地 grow-safe 视图重复，且伴随固定 128 MiB 边界/删除本地接口 | 不整体替换，保留本地 memorySize 与导入/触控/存储能力 |
| 音乐预读、文字优化 | 与 dense Demo 的常规渲染不等价；此次 DATA 包不含外部 BGM | 暂缓，不把上游对话或音乐数据当作手机密集弹幕成绩 |
| v86/FPU 改动 | package 声明仍为 v86 0.5.458；只检查二进制目录元数据 | 未更换 JS/WASM；无依据认定新定制 FPU，更未降低精度 |

上游文档也明确其缓冲/接口优化未呈现稳定的整帧改善。上游第一关/对话测试与当前手机 dense Demo 不是同一分母。

## 分层诊断与配对结果

设备：Windows 桌面 Edge 152、Intel UHD / ANGLE D3D11、640×480，触控关闭，音效链存在、无外部 BGM。测试专用 UTC 时钟固定为 2026-09-09；原版 Lunatic Stage 4 Demo，角色 0/shot 2。生产逻辑时钟不改动。

顺序 A/B/B/A/A/B。每轮先经过原版标题与 Demo 暖机，再取逻辑 Present 1380–1919 共 540 帧，约 9 秒；这是短测，不是 30–60 秒或热稳定验收。A 为旧提交+旧 returns，B 为当前提交+fast returns；两边都保留 perf-2 状态缓存与缓存 CPU 视图。

| 三轮各自统计值的中位数 | A | B |
| --- | ---: | ---: |
| 帧间隔均值 ms | 16.667 | 16.673 |
| 同步 work ms/frame | 5.505 | 5.307 |
| GL submit ms/frame | 0.679 | 0.429 |
| p95 帧间隔 ms | 19.3 | 19.3 |
| p99 帧间隔 ms | 21.9 | 22.0 |

GL submit 降约 36.8%；work 中位数降约 3.6%，但反向一组 work 为 5.935→6.429 ms，不能宣称 work 稳定下降。帧率被原版 60 Hz 限速，尾延迟没有稳定改善。

全部六轮的 540 帧逐帧 draws/batches/x86 instructions 相同。后四轮在窗口结束后的第 1920 帧读取 1228800 字节真实游戏 RGBA，SHA-256 均为 `d9da1e93df41aae15178b0ee9c27a559853e4c6c992a83be715aa0add95b1406`。这证明所测片段一致，不替代全部游戏画面验证。

独立详细 profile：110 个稀疏批次 GPU query，中位 0.004661 ms、最大 0.379791 ms；这些是个别批次，不是整帧 GPU 时间。查询按 Khronos 的 availability/disjoint 规则异步读取，无 gl.finish 忙等；详细 profile 的 work 为 8.19 ms，不能与低干扰模式混比。

110 个样本覆盖整个采样段；严格筛选到 1380–1919 窗口为 96 个，中位 0.005156 ms，最大值相同。所有被采样批次均开启深度，因此没有依据为本场景删除 D16/fragment-depth 路径。

返回微基准：8 组交错、每组 100 万次调用（含相同 ESP reset），中位旧版 180.757 ms、fast 72.329 ms。证明该调用局部少做了工作，不代表整帧加速 2.5 倍。

### 后续独立实验：精确状态快照复用

主动阅读由两位 `gpt-5.6-luna / xhigh` Scout 分别负责 CPU 和渲染链；调度接口标注 priority，没有单独 Fast 参数。主 agent 根据证据取舍、修改与执行全部基准。

单独 census 发现矩阵设置 64696 次中 18000 次字节相同，viewport 设置 13212 次中 11988 次相同。它仍可能产生新快照、触发 COW Map 和逐字节比较。采用原始字节比较而非浮点相等或哈希，保留 NaN payload、signed zero、地址边界与不可变快照。

随后只切换 D3D snapshot 实现，其他 perf-4 条件相同，进行 A/B/B/A 两组短测：

| 两轮统计均值 | 旧快照 | 复用快照 |
| --- | ---: | ---: |
| work ms/frame | 5.505 | 5.106 |
| GL submit ms/frame | 0.429 | 0.383 |
| p95 帧间隔 ms | 19.40 | 19.15 |
| p99 帧间隔 ms | 21.85 | 21.45 |

work 减约 7.3%，两组方向相同，因此保留。四轮仍是约 60 FPS，540 帧逐帧计数一致，第 1920 帧 RGBA 哈希与此前一致。这个百分比属于独立 snapshot 实验，不与前面的 3.6% 相加，不外推手机。

CPU Scout 另提出调用计数门控、native-host 参数读取和关闭触控时早退出。当前没有对它们完成调用契约与收益验证，尤其清栈参数数与实际读取参数不能未经审计混为一谈；本轮不继续叠加这些改动。

当前 `draw` 已采用 `bufferData(typedArray, STREAM_DRAW)` 并从零顶点提交，符合 Playbook 中 VBO 存储更新方向。仍需手机上的 CPU/driver/GPU 分层证据；不能仅因 work 高就归罪模拟器，也不能据桌面 GPU 轻认定手机 GPU 轻。没有修改深度、混合、shader 精度、分辨率或弹幕逻辑。

新隔离基线本身已约 60 FPS，而旧 launcher 报告同 Demo work 约 30 ms；载体/采样/环境差异尚未归因，绝不能把这段差异算作本次补丁收益。

## 验证边界

- 50 项可用单元/真实 v86 测试通过，包含完整返回状态、越界、未对齐、增长与控制取消，以及新增的快照/NaN/signed-zero/queued packet/state-block 差分。
- 最终完整 `tests/*.test.mjs` 为 50 通过、11 失败；失败为缺少旧位置的 EXE、字体或 reference/jp 资源（ENOENT），不是完整套件通过。
- 原版 x86 触控流程 12 项通过（Windows GDI 诊断后端，不是手机画面）。
- 合成 WebGL 五类场景：每场景零差异，含 alpha/depth/fog/scissor、FBO/上传/copy/present、实例化与普通布局。
- 生成版隔离 hosted 浏览器 8 项检查通过：存档 write/sync/reload/read/list、默认无诊断叠层、真实触屏菜单进入第一关、游戏触摸、原版暂停、竖屏保留 640×480、AudioWorklet 非零 PCM、隔离存档删除。不是完整启动器 UI 或外部 BGM 验收。
- 当前没有连接 ADB 手机；用户选择先完成本地工作。手机、30–60 秒配对、5–10 分钟热状态、真实启动器 UI 及外部 BGM验收仍待完成。

## 使用和复现

本轮仅更新本地 `artifacts/validation/th10-touch/runtime/`。未发布、上传、提交或替换远端静态站点。原 DATA 未改动，无需因本次源码更新重新导入相同游戏数据。

```powershell
Set-Location 'D:\workspace\eagler\interpret\worktrees\th10-plugins'
node scripts/prepare-touch-hosted.mjs --runtime-only
$env:TH10_PERF_FIXTURE='1'
$env:TH10_PERF_LIGHT='1'
$env:TH10_PERF_SCENE='demo'
# A
$env:TH10_PERF_BASELINE_CPU='1'
$env:TH10_PERF_SUBMISSION_REFERENCE='1'
node scripts/profile-touch-hosted.mjs my-reference
if ($LASTEXITCODE -ne 0) { throw 'reference failed' }
# B
$env:TH10_PERF_BASELINE_CPU='0'
$env:TH10_PERF_SUBMISSION_REFERENCE='0'
node scripts/profile-touch-hosted.mjs my-current
if ($LASTEXITCODE -ne 0) { throw 'current failed' }
node scripts/test-performance-runtime.mjs
```

详细层采样另开一轮：`TH10_PERF_LIGHT=0`、`TH10_PERF_GPU=1`。不用其 FPS 与低干扰模式计算提升。

手机入口需先实际更新 runtime 并核实 `th10-perf-4` 标记。当前模式参数 `?th10Perf=1`；旧提交+旧返回对照为 `?th10Perf=1&th10LegacySubmission=1&th10LegacyReturns=1`。参数不会自动升级旧部署，不清空站点存储。

原始证据在 `artifacts/validation/mobile-performance/`：`perf4-comparison.json`、六份配对 report、`perf4-snapshot-comparison.json` 与四份 snapshot 配对 report、`perf4-setter-census/report.json`、`perf4-layer-profile/report.json`、`perf4-ret-micro.json`、`perf4-tests.log`、`webgl-cache-pixels.json`、`perf4-runtime-smoke.json`、`perf4-runtime-identity.json`。原版触控证据在 `artifacts/validation/touch-audit/native-touch.json`。

技术参考：[MDN WebGL best practices](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices)、[Khronos disjoint timer query](https://registry.khronos.org/webgl/extensions/EXT_disjoint_timer_query_webgl2/)。同步 GL 查询可能造成调用线程等待；这里的 CPU/GPU 数据按各自采样范围解释。


## 追加：th10-perf-5 上游音乐预读应用

2026-09-10 在用户授权尝试应用后，将上游 PagedMusic 的请求去重、滚动预取、曲首/循环入口常驻机制接入当前 runtime。保留当前 baseURL、外部 URL/Range、hosted 无 BGM 分支；没有改原版 PCM、播放位置、游戏时钟或渲染逻辑。

- 复用上游 TH10 music-layout，18 项与本地原版 953 字节 thbgm.fmt 逐字段匹配。未使用 TH08 曲目地址。
- 入口常驻 162 块，即 40.5 MiB；滚动缓存 16 MiB。入口预算上限 48 MiB，单次需求读取超过缓存容量时暂保留需求块，复制后淘汰。响应/复制瞬时内存不包含在常驻预算内。
- 预载并发 4，滚动预取最多后续 12 块，并限制新增推测请求。推测失败不影响当前播放；按需接管失败的进行中预读时，额外新发一次请求；需求读取校验 HTTP 状态、Content-Range 起止/总长及字节长度。单次推测请求 5 秒超时，启动预读整体预算 10 秒，超时后继续启动并按需补读。所有曲目的预载增加首次加载时间与网络读取量，是消除后续入口等待的交换。
- 无 BGM 分支不构造 PagedMusic、不下载音乐。

验证：12 项缓存测试通过，覆盖预读去重、失败重试、入口保留、外部 URL/Range、baseURL、EOF、大于缓存的读取和错误响应、进行中预读失败接管、挂起请求超时/迟到响应、跳转窗口补排与错误 Content-Range。生成 runtime 的 8 项保存/触控/Stage 1/暂停/尺寸/有声 SFX 检查通过。真实 Worker 的外部 Range 路径以合成静音 PCM 运行到 451 帧，通过全部曲目入口请求覆盖检查；172 请求、45,088,768 字节，无错误。该项不等于原版 BGM 听感或完整曲目循环验收。

确定性合成缓存对照：113 次需求等待 → 仅滚动预读 3 次 → 加入口预载 0 次，输出 SHA-256 一致。但请求数分别为 113、149、256，预载组把这个 1 MiB 合成文件全部缓存；这些数字用于机制验证，不是游戏 FPS 或 CPU 收益。

复现：`node --test tests/music-cache.test.mjs`；`node scripts/test-music-prefetch.mjs`（需本轮 perf5-baseline）；`node scripts/prepare-touch-hosted.mjs --runtime-only`；`node scripts/test-performance-runtime.mjs`；`node scripts/test-music-hosted.mjs`。

新增证据：`artifacts/validation/mobile-performance/perf5-{layout,music-comparison,runtime-smoke,music-hosted}.json`。生成 runtime 仅同步小模块和清单，未读取/复制游戏 DATA 或 v86。本轮没有手机结果，没有宣称解决持续 CPU 高占用。


CRT 候选暂未应用：主线程已实际读取本地 487,936 字节 TH10 EXE 并确认 SHA-256 为正确原版，导入表只有 HeapAlloc/HeapFree/HeapReAlloc 等 OS 入口，没有可直接按导入名替代的 malloc/free/calloc。现有导入级宿主服务已存在；要跳过内部 CRT 还缺少该版本内部地址、代码签名、完整 ABI 和行为等价证据。不能把 TH08 三个固定地址用于 TH10。此项不是缺少本地 EXE，证据见 perf5-crt-imports.json。本轮未进行大范围反汇编或未经验证的内部函数替换。

独立 Luna xhigh 审查提出的四项边界已修复并由同一 Reviewer 复核闭合：进行中预读失败接管、启动预读超时、跳转窗口补排和 Range 区间验证。最终三个运行模块与生成目录和 runtime-files.json SHA-256 一致，证据为 perf5-runtime-identity.json。
