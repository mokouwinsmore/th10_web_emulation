# 来源记录

- 游戏程序、DAT、BGM、现成简体汉化文本与图像：用户本地提供的 `[th10] 东方风神录 (汉化版+日文版)`。原作：上海アリス幻樂団 / ZUN。各版本 SHA-256 见 dist/manifest.json。
- x86 执行器：[copy/v86](https://github.com/copy/v86)，安装版本 `0.5.458+gd96be77`。许可见 dist/vendor/v86.LICENSE。浏览器运行使用该执行器的 WASM 和 JavaScript。
- D3DX9_31 x86：[Microsoft DirectX End-User Runtimes (June 2010)](https://www.microsoft.com/en-us/download/details.aspx?id=8109)。从 Microsoft 原始自解压分发包提取 OCT2006_d3dx9_31_x86.cab 内的 DLL；未执行安装程序。下载包 SHA-256：`053f76dcbb28802e23341b6a787e3b0791c0fa5c8d4d011b1044172dbf89c73b`，Microsoft 数字签名核验通过。DLL 作为浏览器执行器的数据加载，不注册到 Windows。
- Direct3D 9 ABI 参考：[Wine d3d9.h](https://github.com/wine-mirror/wine/blob/master/include/d3d9.h)、[d3d9caps.h](https://github.com/wine-mirror/wine/blob/master/include/d3d9caps.h)。运行适配层为本项目代码。
- 游戏状态地址与核对辅助：[touhouworldcup/thprac](https://github.com/touhouworldcup/thprac/blob/master/thprac/src/thprac/thprac_th10.cpp)。仅用于对照版本地址、设置诊断场景；游玩包不包含 thprac 或辅助作弊逻辑。
- 数据格式检查：[thpatch/thtk](https://github.com/thpatch/thtk)。仅开发阶段解包和核对，游玩时直接使用原版 DAT。
- CPU 独立核对：[Unicorn](https://github.com/unicorn-engine/unicorn) / `@alexaltea/unicorn-js 2.1.4`，仅开发测试。
- GDI / 原生 Direct3D 对照：本机 Windows 的 GDI、Direct3D 9。测试窗口隐藏，绘制到离屏表面；所有诊断可执行文件均排除在游玩包之外。
- 1.0.1 文字性能优化：依据本地 TH10 1.00a 与 D3DX9_31 的反汇编和浏览器 CPU 剖析，优化原版透明边缘着色与浮点行运算。缩放系数由原始 DLL 生成后缓存；与未加速指令的输出对照。接口语义核对使用 Microsoft 的 [D3DXLoadSurfaceFromMemory](https://learn.microsoft.com/en-us/windows/win32/direct3d9/d3dxloadsurfacefrommemory) 与 [D3DX_FILTER](https://learn.microsoft.com/en-us/windows/win32/direct3d9/d3dx-filter) 文档。
- Node.js `v24.15.0`：用于本机 HTTP 服务，来自当前机器安装的官方运行时，OpenJS Foundation 签名核验有效。许可见 tools/Node.LICENSE。
- Playwright `1.60.0` 与 Koffi `3.2.1`：仅开发测试，不是游玩依赖。

已有妖妖梦和永夜抄网页项目只用于参考通用平台处理方式。没有将它们的角色、关卡脚本、判定或音效规则当作风神录的游戏逻辑。
