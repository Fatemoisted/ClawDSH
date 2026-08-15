# OpenClaw 渠道宿主锁定

[English](README.md) | 中文

本目录固定生产和 Canary OpenClaw 渠道宿主及其面向用户的聊天渠道目录。目录覆盖 27 个生产聊天渠道和 31 个 Canary 聊天渠道；相关的 Voice Call 插件不在此清单内。

## 产物

- [host.production.json](host.production.json) 固定稳定版 Git tag、peeled commit、npm tarball 及其解包后的普通文件树。
- [host.canary.json](host.canary.json) 固定经批准的 `main` 观测及经核实的 GitHub 源码归档，而不会在检查时解析持续变动的分支；未发布 npm 产物的字段保持 `null` 和 `cataloged`。
- [channels.production.json](channels.production.json) 记录稳定支持目录及经核实的安装产物。
- [channels.canary.json](channels.canary.json) 记录 Canary commit 观测时的渠道目录。
- [support.production.json](support.production.json) 记录四级生产支持状态投影和显式 opt-in 策略。
- [support.canary.json](support.canary.json) 记录 source-only Canary 快照的同类投影。
- [governance.production.json](governance.production.json) 记录 external 精确包、许可证声明，以及相互独立的许可证、平台条款和安全审查状态。
- [governance.canary.json](governance.canary.json) 为 Canary 轨道的全部 external 包记录治理投影，其中包括 Canary 专属包。
- [schema.ts](schema.ts)、[tree.ts](tree.ts) 和 [verify.ts](verify.ts) 负责结构、跨文件、证据和可选解包文件树校验；[generate-parity.ts](generate-parity.ts) 负责生成四级状态文档投影。

## 分发状态

| 状态 | 含义 |
| --- | --- |
| `core` | 渠道实现属于宿主核心，没有独立渠道包。 |
| `bundled` | 扩展随宿主产物分发，没有经独立核实的安装产物。 |
| `repo-official` | OpenClaw 在自身仓库中维护扩展源码；只有经独立核实时才锁定精确 npm 产物。 |
| `external` | 渠道源码在 OpenClaw 仓库外维护，并锁定可信目录中的精确 npm 产物。 |

`npm.status: "verified"` 要求精确包名、版本和规范 SHA-512 SRI。`npm.status: "cataloged"` 只表示存在源码目录证据，不声称有精确安装产物，因此未经核实的版本和 integrity 字段为 `null`。

状态等级表示与宿主所有权的距离，不表示功能质量。Canary 必须包含每个生产渠道，共有渠道可以保持状态，或沿 `core` → `bundled` → `repo-official` → `external` 向外移动。

## 支持状态

| 状态 | 含义 |
| --- | --- |
| `cataloged` | 已记录渠道标识与来源；仅锁定产物并不表示已完成渠道装配。 |
| `installable` | 已同时记录精确产物、渠道配置说明、能力探测和 keyless contract test 证据。 |
| `certified` | 渠道可安装，且 `certifications` 记录带时间戳、证据引用和真实账号的冒烟测试。 |
| `enabled` | 渠道已认证，且 `enablements` 记录选择该渠道的部署配置。 |

生产和 source-only Canary 投影分别将全部 27 个和 31 个渠道标为 `cataloged`，且不记录任何可安装性、认证或启用证据。精确的生产宿主和包锁仍是独立产物事实；只有每个渠道另有三项 `installability` 证据引用后才可晋升。分发状态为 `external` 的渠道使用 `optIn: true`；其他渠道都使用 `optIn: false`。校验器拒绝没有精确产物和装配证据的 `installable` 或更高状态、没有真实账号冒烟证据的 `certified` 或 `enabled`、没有部署证据的 `enabled`，以及任何不符合分发所有权的 opt-in 值。

## External 治理

每个 external 包都以与渠道目录相同的包名、版本和 SRI 重复记录在对应轨道的治理目录中。Registry manifest 中的许可证值只是一项声明，不表示法律审查通过。`license`、`platformTerms` 和 `security` 分别记录 `pending-review`、`approved` 或 `blocked` 结论及其证据引用。三项结论全部为 `approved` 前，external 渠道不能晋升为 `installable`。仓库内记录刻意保持 `pending-review`；QQ Bot 2.0.1 的 registry manifest 没有声明 SPDX 许可证，其余四个已观测包声明 MIT。

## 离线校验

校验器不会发起网络请求。它检查本目录 JSON 文件的 schema 版本、宿主、渠道、支持和治理目录一致性、固定总数和各分发状态数量、已排序且不重复的标识符、包证据、规范 SHA-512 SRI、支持与治理要求、external opt-in 策略，以及从生产到 Canary 的成员和分发状态单调性。HTTPS 证据引用必须包含有效 hostname。仓库相对证据引用以 ClawDSH 仓库根目录为基准解析，在解析符号链接后仍须位于该根目录内，并且必须指向普通文件；其他 checkout 可用 `--repo-root` 覆盖根目录。`generate-parity.ts` 从目录生成两份 `docs/matrix/parity.md` 文档中的四级支持状态计数；CI 校验该生成区，而不接受手工维护的单一勾选汇总。

```sh
pnpm exec tsx tools/openclaw-channel-host/verify.ts --check
pnpm exec tsx tools/openclaw-channel-host/generate-parity.ts --check
```

```sh
pnpm exec tsx tools/openclaw-channel-host/verify.ts --check --repo-root /absolute/path/to/ClawDSH
```

### 解包后的生产文件树

传入生产 npm 包的解包根目录即可校验内容树。算法递归收集普通文件的绝对路径，以 JavaScript `.sort()` 排序；每个文件依次向同一个 SHA-512 哈希写入相对 POSIX 路径、NUL、十进制字节长度、NUL 和该文件的原始 SHA-512 摘要。符号链接、socket 或其他非普通条目会使文件树被拒绝；它们不会从摘要中静默省略。

```sh
pnpm exec tsx tools/openclaw-channel-host/verify.ts --check --host-root /absolute/path/to/package
```

## 维护

1. 只有在基线获得批准后才同时更新宿主锁、渠道目录、支持目录和 external 治理目录，包括精确源码 ref、commit、观测时间及源码 manifest（元数据清单）版本。
2. 只有在获得精确 registry 版本和 SRI 时才把 npm 元数据记为 `verified`；否则使用 `cataloged`，并将未经核实的字段设为 `null`。
3. 只有记录配置、能力探测和 keyless contract 证据后，才把支持项晋升为 `installable`；external 项还要求许可证、平台条款和安全审查全部通过。
4. 只有存在真实账号冒烟记录时才把支持项晋升为 `certified`，只有存在部署证据时才晋升为 `enabled`；external 渠道在每个等级都保持显式 opt-in。
5. 运行离线校验、聚焦 Vitest 测试、TypeScript 校验和仓库文档检查。

```sh
pnpm exec vitest run --config tools/openclaw-channel-host/vitest.config.ts
pnpm exec tsc -p tools/openclaw-channel-host/tsconfig.json
```

## 限制

- 校验器不会下载产物、解析 dist-tag，也不会访问 GitHub 或 npm；它读取仓库内证据文件时只校验位置和文件类型。
- 解包文件树校验是可选项，目前只适用于生产宿主锁。
- Canary 源码归档是可复现的源码输入，不是构建后的部署产物；托管部署需要另行锁定构建产物。
- Registry 许可证声明不表示法律审查通过，仓库内的待审状态也不批准凭据、平台条款或供应链安全性。
