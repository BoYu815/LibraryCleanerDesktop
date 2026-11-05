# 资料库管家 · LibraryCleanerDesktop

一个独立的 Windows 桌面工具，用于管理 ChatGPT 资料库，以及查看 ChatGPT/Codex、DeepSeek Harness 的桌面项目。自有界面使用简体中文与微软雅黑，不需要另外安装浏览器扩展。

## 下载与使用

从 [Releases](https://github.com/BoYu815/LibraryCleanerDesktop/releases) 下载 Windows x64 免安装 ZIP，解压后打开 `LibraryCleaner.exe`。

请保留整个解压目录，不能只复制 EXE。当前版本为 **1.1.2**。程序未进行 Windows 代码签名。

## 功能与当前状态

| 功能 | 当前状态 |
| --- | --- |
| ChatGPT 资料库 | 搜索、类型及日期筛选、ZIP 备份、确认后删除；真实账号操作需自行登录验收 |
| ChatGPT/Codex 本地项目 | 官方本机接口读取名称和目录，确认后从原软件移除，并重新读取列表核验 |
| DeepSeek Harness 桌面项目 | 默认只读；启用连接器并重启 DeepSeek 后才开放移除，真实宿主连接仍待验收 |
| ChatGPT 云端项目 | 登录后根据正常页面响应尽力读取，仅查看，未提供删除 |
| DeepSeek 附件清理 | 尚未实现 |

从项目栏移除项目会保留本地文件夹与会话记录；DeepSeek 会话可能成为未分组会话。此操作不等于永久删除聊天、附件或磁盘文件。执行前请检查确认弹窗中的平台、项目名称和影响范围。

## 不同电脑上的路径

按当前 Windows 用户定位 `.codex`、`.dsh`，支持 `CODEX_HOME` 与 `DSH_HOME`。Codex 官方接口程序根据安装信息查找，项目关联目录直接读取原软件记录。

特殊安装位置无法自动找到时，在“桌面项目 → 连接设置”中选择官方 `codex.exe` 或实际数据目录。自定义配置只保存在本工具当前用户的数据目录，不移动原软件数据。

DeepSeek 第一次连接需点击“启用 DeepSeek 连接”，确认配置修改并重启 DeepSeek Harness，再刷新列表。工具会先备份插件配置；连接器使用本机命名管道，不开放网络端口。宿主版本差异仍可能影响兼容性。

详见 [使用说明](docs/使用说明.md)。

## 1.1.2 登录流程修复

点击连接后先显示原始 ChatGPT 网页供你登录，登录页不会自动被管理面板覆盖。完成登录后，请主动点击顶部“打开资料库”。即使原网站跳转到 /library，登录视图也会保持原始页面；不会仅凭地址自动切换。

## 1.1.1 修复

优先读取已登录会话，为账号识别请求增加超时和后备识别。失败时显示具体原因并提供“重试识别”，新增顶部“登录页面”入口，不清除已有登录信息。真实账号兼容性仍需使用者实际验收。

## 从源码运行

需要 Windows、Node.js 24 与 npm。

```powershell
npm ci
node node_modules/electron/install.js
npm test
npm start
```

构建免安装目录：

```powershell
npm run dist
```

产物位于 `release/win-unpacked`。`npm run smoke` 使用独立测试配置和虚构文件、项目进行完整演示测试，不操作真实账号。

自动生成的 `extension/` 不纳入源码提交；修改适配逻辑请编辑 `src/` 或 `scripts/prepare.cjs`。

## 验证与数据保护

1.1.2 已通过 19 组自动测试和最终 EXE 的 15 项演示检查。Codex 官方接口曾对一个临时测试项目验证创建、列出、移除，并确认本地测试文件保留。没有移除用户原有项目。DeepSeek 连接器仅在模拟注册表上验证操作，真实宿主验收尚未完成。

保持 Electron 隔离和沙盒开启。登录由使用者自行完成；仓库不包含账号会话、Cookie、本机连接配置或实际项目记录。程序没有开发者运营的数据转发服务器。

## 来源与许可

资料库界面基于用户提供的 [GPT Library Cleaner](https://github.com/index7777/GPT-Library-Cleaner)，原文件保留在 `vendor/original`。提供的上游压缩包未包含 LICENSE；本仓库没有替上游授予开源或再分发许可，使用和再次分发前请核实权利。参见 [第三方说明](THIRD_PARTY_NOTICES.md)。

这是非官方个人工具，与 OpenAI、DeepSeek 无官方隶属关系。
