<!-- ══════════════════════════════════════════════════════════════
     ClawDSH 贡献前言；下方上游原文保持不变。
     ══════════════════════════════════════════════════════════════ -->
# 为 ClawDSH 作出贡献

[English](CONTRIBUTING.md) | 中文

ClawDSH 欢迎范围明确的 Issue、提案、文档改进、Bug 修复与功能 PR。本项目把 OpenClaw 的个人助手能力重建为 DeepSeek Harness 上的插件；贡献必须保持这一插件边界和仓库的上游同步纪律。

提交代码前：

1. 搜索[功能矩阵](docs/matrix/parity.md)与既有 Issue，再新建或引用一个清楚描述用户可见问题的本仓库 Issue。
2. 新功能应先编写或更新对应的 `docs/specs/feature-*.md` 规格或 owning ADR，再进入实现。
3. ClawDSH 实现只能位于 [AGENTS.md](AGENTS.md) 列出的自有面。若缺少上游 seam，应先写 ADR 与上游 proposal，而不是使用私有 import 或直接修改上游核心。
4. 遵守[插件契约](docs/standards/plugin-contract.md)和 [PR 政策](docs/standards/pr-policy.md)；在同一变更中更新对齐矩阵、受影响文档、测试和必需的 Agent Note。
5. 在 PR 中列出改动过的全部上游文件和实际运行的精确检查。不得提交凭据、本地生成状态、registry token 或 `.env` 文件。

贡献按本仓库的 MIT License 提交。下方保留 DeepSeek Harness 的上游贡献原文；其中暂不接受上游外部 PR 的限制不代表 ClawDSH 的贡献政策。

---

<!-- ⬇ 上游 CONTRIBUTING 原文（为署名与 rebase 保持不变） -->

# 贡献

[English](CONTRIBUTING.md) | 中文

感谢你愿意为 DeepSeek Harness 作出贡献！

我们深信开源社区的力量，这份信念从项目最初就塑造着 DeepSeek Harness。

DeepSeek Harness 仍处于早期阶段，并在积极开发中。很抱歉，我们目前无法接受外部 PR（Pull Request）。不过，贡献代码远非帮助本仓库建设的唯一途径。你还可以通过许多其他方式参与进来：

- 在 GitHub Discussions 中发现并报告问题或 bug：
  - 为你希望引起团队关注的讨论投票。我们的团队规模很小，可能无法回复每个帖子，但我们会持续关注，并在分配资源时将这些讨论纳入考虑。
- 为生态系统作出贡献：
  - 创建令你感兴趣的插件，并分享给其他人：
    - 为你的 GitHub 项目添加 `dsh-plugin` 话题，让其他人更容易找到你的插件。
  - 撰写有关 DeepSeek Harness 的博客文章和操作指南。
  - 回答问题并帮助其他社区成员。

DeepSeek Harness 的设计支持深度定制。我们并不认为官方仓库中的包天然就比社区开发的包更重要。你可以将本仓库看作一种理念、一份官方示例以及一处灵感来源，而不是我们要求社区遵循的方向。

我们已经看到社区中涌现出令人期待的项目，也希望生态系统继续沿着自己的方向发展。

探索未至之境。
