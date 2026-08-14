# PR 政策（反 OpenClaw 病）

[English](pr-policy.md) | 中文

> OpenClaw 的死亡模式：社区 PR 无门槛涌入核心、功能堆叠无规格、回归无人负责。本政策让这一切在**流程上**不可能发生——架构上 Cordis 已经让它很难发生。

## 合入门槛（四条，缺一不可）

1. **规格链接**：PR 必须链接 `docs/specs/feature-*.md` 或对应 ADR；无规格的新功能先写规格再写代码（规格 = 目标 / 非目标 / 接缝 / 配置面 / 验收标准五段）。
2. **矩阵同步**：涉及功能域变化的 PR 必须同步更新 `docs/matrix/parity.md`（新增/重新分类/状态推进）。
3. **契约测试**：按 `docs/standards/plugin-contract.md` 第 6 节提供契约测试 + profile 冒烟。
4. **边界声明**：PR 描述必须写明"改了哪些上游文件（应为空或仅品牌段）"——**触碰上游核心代码的 PR 一律拒绝，引导改成插件/ADR 方案**。

## 明确拒绝的类型

- 直接修改 `packages/*`（openclaw/ 除外）、`vendor/`、`apps/`、`website/` 的功能性改动；
- 不通过 seam、以 import 上游内部实现方式实现的"插件"；
- 绕过新 seam 准入流程的渠道/能力接入；
- 重复功能：先查矩阵，已有同类包则改为向既有包提改进 PR。

## 里程碑冻结

- 每个里程碑（对应 roadmap 阶段）收尾时**功能冻结**：只修 bug、只做契约修复，新功能排入下一里程碑；
- 冻结期内社区 PR 标注 `next-milestone` 暂存，**不 close 不 merge**——这是对 OpenClaw 教训的最直接回应：PR 可以等，核心不能烂。

## 兼容 OpenClaw 生态的承诺

- 欢迎来自 OpenClaw 社区的功能提案：把它们翻译成"规格 + 插件包"形态是我们的核心价值；
- 提案翻译模板：`docs/specs/feature-*.md` 的"OpenClaw 对应"一节必须写清来源（PR/issue 链接或功能名），保证溯源。
