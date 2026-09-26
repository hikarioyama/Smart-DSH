# Windows 安装说明 — 0.3.0

2026-09-12，用户反馈 Windows / DSH `0.1.5-rc.1` 上实际使用通过。安装载体为 tarball；独立自动检查也覆盖 rc.1、rc.2 的安装、启动、认证 RPC 和卸载。

## 安装前

- 确认平时使用的 DSH 启动器及版本，复用该启动器；不要照抄他人的 npx 缓存路径。
- 备份目标 Profile 已存在的 manifest、lockfile 和配置/patch 文件。
- PowerShell 使用 `$dshProfileHome`，不要用 `$home`：它会与内置 `$HOME` 冲突。
- 按 [README](../README.md#安装) 打包安装；开发目录链接可能带入另一版本的依赖。tarball 也不替代实际依赖解析检查。

## 常见情况

| 现象 | 判断与处理 |
| --- | --- |
| `.ps1` 被执行策略拦截 | 使用 `npm.cmd`、`pnpm.cmd` 或由 node 调用 CLI JavaScript，不必降低系统执行策略。 |
| `dsh plugin --help` 显示 pnpm 帮助 | 此版本的 plugin 管理命令会转发参数给 pnpm。 |
| 缺少 `--profile` | 使用 `dsh plugin --profile web add <artifact> --ignore-scripts`；参数位于 plugin 之后、add 之前。 |
| 装完没有 `/btw` | 停止并重新启动 DSH，再刷新浏览器；patch 热更新不等于新 bundle 已装载。 |
| HTTP 401 | 认证先于端点处理；先用正常 DSH 启动链接认证。401 不能证明路由存在或不存在。不要公开 token/cookie。 |
| peer dependencies 警告 | `autoInstallPeers: false` 的 Profile 可能由宿主提供依赖；核对版本后才能接受，不能一律忽略或盲目补装官方组件。 |
| `-NoProxy` 参数不存在 | 检查 PowerShell 版本，Windows PowerShell 5.1 不支持该参数。 |
| JSON 解析失败 | 先用 UTF-8 读取具体文件再调查，不应直接认定包已损坏或忽略所有错误。 |

## 核对实际安装

`--dump-config` 应包含一个插件自有 `id: btw`。用 `createRequire()` 锚定安装目录中插件的 `package.json` 检查依赖；不要从仓库目录下的同名包 self-reference 推断安装结果。

本次只读复查确认 `dsh-llm`、`dsh-llm-pi-ai`、`dsh-session` 均解析到宿主 rc.1。浏览器模块加载、实际问答和缓存行为是不同层次的验证。

## 更新与隐私

- Profile 依赖指向 `file:` tarball 时保留该文件。更改插件后使用新版本号和新产物名，避免旧 lockfile 摘要/缓存混淆。
- 更新后重启 DSH。DSH 自身升级后也应复测：缓存桥接只检查部分内部结构，不能保证所有不兼容都 fail closed；某些情况可能退回公共调用路径。
- 默认 `private-jsonl` 会在 `$DSH_HOME/btw-sidechains/v1` 保存问题、共享上下文快照和回答，不一定包含全部历史消息。需要时改为 `memory` 或 `none`；卸载不会删除已有记录。

具体测试范围见[兼容性记录](./compatibility-0.3.0.md)。
