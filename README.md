# DSH RP Story Kit

DSH 原生角色与玩家资产库：导入 Character Card V2/V3 JSON 或常见 chara/ccv3 静态 PNG，保留原件，编辑版本、玩家身份与多个开场，交换数据内容包。世界设定卡也可以直接保存。

当前为 **0.1.0 实现检查点**：包含共享 GM 启动接线、阅读稿与精确身份存档协调。入口按当前真实服务能力启用；完整原生整链验收与发布由协调方统一进行。检查证据的范围见 [验收说明](docs/acceptance.md)。

## 安装与使用

目标宿主 **DSH 0.2.1-rc.3**，Node >=24。开发完成的本地包可以安装到 DSH profile：

```powershell
dsh plugin --profile desktop add ./artifacts/dsh-rp-story-kit-0.1.0.tgz
```

重启 DSH 后，点击会话顶部或空白会话的“资产”，打开右侧原生面板；若安装 RP Studio，工作区内也有入口。资产库无需 GM、Database 或 LastStep 即可使用。侧栏尺寸、全屏与主题由宿主管理。

- 从“导入资产”选择 JSON/PNG，或粘贴 JSON。导入后审阅原件、来源提示与两个或更多开场。
- 从“新建角色资产”创作角色或世界设定；“新建玩家身份”保存轻量玩家角色。同名资产有不同 ID。
- 编辑后保存新版本。其他窗口修改时保留本地草稿，显式重新载入才放弃修改。
- 示例对话仅供语气参考，不是已经发生的故事。作者系统文本、宏、脚本和未知扩展仅保存在来源中。
- 内嵌世界书通过 RP Database 委托导入；缺少插件时保持待导入状态。Database 版本和政策由其服务负责。

PNG 读取优先 ccv3，否则 chara；支持常见 tEXt 编码。优先元数据无效会明确报错。ZIP/APNG 暂不支持。所有原始文本/字节和 SHA256 均保留，JSON BOM/CRLF 不因解析而改写。

## 开始与继续故事

组合版本为 GM0.1、Database0.2、LastStep0.3；Context0.2 与 Loop0.1 可选。将所需包安装到同一个 DSH profile。

选择已保存的角色版本、玩家身份和开场，填写并审阅初始场景/事实，再点击“开始故事”。角色描述、性格、情境和 persona 描述作为固定来源交给共享 GM；示例对话只作写法参考。启动模型由 DSH/GM 继承，节点路由可在 Loop 配置。

预设选择顺序是：明确指定的就绪版本优先；明确选择“GM 默认”使用内置预设；沿用资产关联时读取角色的 profileRef。关联版本缺失或尚为 draft 会明确报错，保留用户选择。

启动前保存不可变审阅请求和 launchId。连接中断后，“待继续启动”使用原始请求继续，保持原资产版本、开场与 seed。GM 返回 starting 时界面显示等待真实开场；active 由实际原生开场提交决定。

## 内容包

“内容包”可检查、导入包 JSON，或导出当前已保存资产与选定玩家身份，再下载 JSON。引用数据库/预设的包通过对应插件的 exportContent/importContent/contentRevision 服务处理。

包格式为 dsh-rp-story-pack/schemaVersion 1；内容身份按原 ID + 版本在包内解析。导入生成新 ID 并重映射资产、资料、预设、模板和资源引用；预设保持待审阅草稿。外部服务导入中断时保留完成项和 requestId，重试继续未完成项。没有跨服务原子事务承诺。

包不携带凭据、本机绝对路径、可执行资源/模块、provider 配置或运行日志。来源中的脚本元数据保持 inert，不能执行。此格式用于复用内容；完整存档的 exact-ID Session 恢复使用独立合同。

文档随 PackDatabase.documents 独立传递，校验原始字节、extraction/chunk 哈希及条目来源引用。新的 documentMappings 附在各数据库版本映射下；原始 SourcePayload/provenance 保留审计原样。检索向量缓存由 Database 重建。

## 阅读稿与完整故事存档

“故事迁移”导出当前原生会话的 Markdown/TXT 阅读稿或完整故事存档。阅读稿来自 LastStep 的当前正式正文投影，反映已采用的文字。

完整存档使用 dsh-rp-saved-story/schemaVersion1、identityMode=preserve，包含祖先、原始 headers/events/inheritedEventCount、所需插件状态与可选会话 Loop 政策。只捕获空闲且没有待执行输入的故事；内容或来源在捕获期间变化会要求显式重试。

在目标环境预检文件，记录“恢复任务 ID”，再按原 ID 恢复。目标已有同名 Session ID 时先报告冲突；固定内容 ID/版本只有内容相同才可复用。中断后使用**相同文件、同一恢复任务 ID**继续，进度由服务端 journal 保留。

预检若列出 LOOP_NODE_VALIDATION，表示基础依赖通过，实际节点兼容性将在暂存、冷验证与无 prompt resume 后检查。节点、模型或插件缺失时保持 pending/未激活，保留原路由。Context 在来源环境缺席时记录 null；目标若装有 Context，只对恢复会话配置 disabled。详见 [存档与传输](docs/transfer.md)。

## 开发与验证

```powershell
pnpm install --frozen-lockfile --ignore-scripts
pnpm check
pnpm skill:check
pnpm package
```

Node 24、pnpm 11.9.0；生产 host 为独立 ESM bundle，client 使用 DSH 已有 React 18。没有兄弟仓库源码依赖。包和 SHA256SUMS 位于 artifacts。CI 配置覆盖 Windows/Ubuntu；本地结果与远端 CI、真实 rc.3 宿主验收分别报告。

数据位于 $DSH_HOME/app-data/rp-story-kit/story-kit-store.json，默认 ~/.dsh。关闭宿主后可备份资产数据；不要将含原件的本机存储当作公开日志上传。

随包提供 adapting-roleplay-story-assets skill，包含字段映射和“设定卡/示例不是事实”的完整行为例子。参阅 [API 与架构](docs/architecture.md)、[skill 验证范围](docs/skill-evaluation.md)、[公开合成角色卡](examples/harbor-v2.json) 和 [玩家身份](examples/traveler-persona.json)。MIT License。
