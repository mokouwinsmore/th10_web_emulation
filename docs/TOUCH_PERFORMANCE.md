# TH10 移动端性能复测：th10-perf-1

这是 perf-1 历史记录。当前本地版本与证据见 [2026-09-10 perf-4 接手结果](MOBILE_PERFORMANCE_2026-09-10.md)，手机问题尚未完成真机复测。

## 状态与范围

用户已确认手机能够启动和操作，但报告天玑 8400 设备在关闭触控时仍很卡，且弹幕越多越卡。
这确认了当前版本的移动端性能问题，不是手机性能验收通过。

本次优化只改宿主对 v86 寄存器、内存和上下文的访问。没有降低分辨率、逻辑频率、弹幕数量或浮点精度，
没有加入触控 Replay，也没有加载 thprac/thcrap。

## 本次修改

- `runtime/wasm-state-views.mjs`：用真实 TypedArray 视图代替宿主热路径上的逐次 Proxy 访问。
  视图类型、偏移和长度取自当前 v86，不硬编码。WASM Memory.buffer 改变后重新建立视图。
- `runtime/jit-machine.mjs`：寄存器、读字、线程上下文及运行循环使用该缓存。
  v86 自身对象、代码写入/JIT 失效、x87 行为和边界检查保留。
- `runtime/frame-performance.mjs`、`runtime/hosted-main.mjs`、`runtime/browser-worker.js`、`th10.html`：
  仅显式传入 `th10Perf=1` 时显示轻量诊断。默认不逐步计时。

## 手机怎么复测

使用手机已经能打开的同一个启动器入口，不更改网络、反代或服务器监听范围。

优化路径：启动器网址查询参数加 `th10Perf=1`。

```text
?th10Perf=1
```

原 Proxy 访问方式的对照路径：

```text
?th10Perf=1&th10LegacyViews=1
```

网址已有 `?` 时用 `&` 追加。每次退出游戏并刷新启动器，再启动同一角色、难度的同一关。
不要让两份游戏同时运行。保持相同屏幕方向、浏览器及触控开关状态。

画面角落应出现 `th10-perf-1 · cached` 或 `th10-perf-1 · reference`。
若没有该版本标记，不要用旧页面的结果评价本次修改；先核对测试站是否已更新运行时。
本次没有发布或部署任何远端站点。仅更换 URL 参数不能把旧静态部署更新成新版本。

读数说明：

- `Present ... FPS` 是当前实际完成的 Present 速率，不是手机屏幕刷新率。
- `work ... ms/frame` 是 Scheduler.step 中的同步工作耗时，包含宿主/API/同步 GL 调用及可能的等待，
  不是纯 x86 CPU 时间，也不是 GPU 时间；加载时的异步 I/O 不在这个数值内。
- `draws ... → batches ...` 是每帧收到的绘制包和提交批次数，不是弹幕数量。

先记录标题菜单，再记录同一关弹幕较多的相近位置。截图保留版本、FPS 和 work，并记录手机浏览器名称。
这两个参数都可以去掉；优化的 cached 路径仍是默认，诊断显示关闭。
不要为刷新代码清空站点存储，以免误删个人存档。

## 本地重新生成与测试

工作区验证运行时已经重新生成。再次生成可执行：

```powershell
Set-Location 'D:\workspace\eagler\interpret\worktrees\th10-plugins'
node scripts/prepare-touch-hosted.mjs
```

验证输出：`artifacts/validation/th10-touch/runtime/`。
本次原版 DATA 的 SHA-256 不变，因此已导入的相同 TH10 游戏数据不必为了这次纯运行时修复重新导入。
其他路径上的静态测试副本需要更新其运行时文件；本轮没有擅自替换它们。

低干扰桌面 A/B（自动临时使用本机 18132 端口，结束后关闭）：

```powershell
$env:TH10_PERF_LIGHT='1'
$env:TH10_PERF_REFERENCE='1'
node scripts/profile-touch-hosted.mjs reference-repeat
if ($LASTEXITCODE -ne 0) { throw 'reference failed' }
$env:TH10_PERF_REFERENCE='0'
node scripts/profile-touch-hosted.mjs cached-repeat
```

`TH10_PERF_LIGHT=1` 不启动 CPU profiler，也不逐 API 计时；原始报告中的 `apiMs`、`renderMs` 为未采集的占位值，
不能解释为真实 API/渲染耗时为零。删除该环境变量可以使用详细 CPU 剖析模式，结果不能与低干扰模式混比。

## 实测结果与边界

2026-09-09，本机 Edge 152、Intel UHD Graphics、640×480、第一关、触控关闭的一组对照：

| 指标 | reference | cached |
| --- | ---: | ---: |
| 纳入均值的帧数 | 589 | 589 |
| 平均帧间隔 | 35.30 ms | 23.41 ms |
| 按平均帧间隔计算的速率 | 28.33 FPS | 42.71 FPS |
| 每帧同步工作时间 | 33.86 ms | 22.11 ms |
| 每帧绘制调用 | 55.703 | 55.703 |
| 每帧提交批次 | 23.353 | 23.353 |
| 每帧记录的 x86 指令数 | 290818.219 | 290818.219 |

这是一次桌面局部测量，不是手机增益、全游戏稳定帧率或满屏弹幕验收承诺。
原始证据：`artifacts/validation/mobile-performance/reference-light/report.json` 和
`artifacts/validation/mobile-performance/cached-light/report.json`。
详细剖析证据分别在同级 `baseline/` 和 `direct-views/` 中，包含 `worker.cpuprofile`。

本轮已通过 30 项基础/真实 v86 内存增长测试、12 项原版触控逻辑测试，以及 10 项真实启动器浏览器触控检查。
正常浏览器路径验证时未启用性能叠层。新旧路径的版本/模式标记则由性能脚本单独校验。
仍待此设备上的新构建复测、密集弹幕与长时间热状态检查；不能据桌面结果宣布手机卡顿已解决。
