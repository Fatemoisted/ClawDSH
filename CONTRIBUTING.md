<!-- ══════════════════════════════════════════════════════════════
     ClawDSH contribution prelude; keep the upstream text below unchanged.
     ══════════════════════════════════════════════════════════════ -->
# Contributing to ClawDSH

English | [中文](CONTRIBUTING.zh.md)

ClawDSH welcomes focused issues, proposals, documentation improvements, bug fixes, and feature pull requests. The project rebuilds OpenClaw personal-assistant capabilities as plugins on DeepSeek Harness; contributions must preserve that plugin boundary and the repository's upstream-sync discipline.

Before opening code:

1. Search the [feature matrix](docs/matrix/parity.md) and existing issues, then open or reference one repository issue that states the user-visible problem.
2. For a new feature, write or update its `docs/specs/feature-*.md` specification or the owning ADR before implementation.
3. Keep ClawDSH implementation in the owned surfaces listed by [AGENTS.md](AGENTS.md). A missing upstream seam starts with an ADR and upstream proposal, not a private import or direct upstream-core edit.
4. Follow the [plugin contract](docs/standards/plugin-contract.md) and [PR policy](docs/standards/pr-policy.md); update the parity matrix, affected documentation, tests, and required Agent Note in the same change.
5. In the pull request, identify every upstream file touched and list the exact checks run. Do not commit credentials, generated local state, registry tokens, or `.env` files.

Contributions are submitted under this repository's MIT License. The section below is the retained upstream DeepSeek Harness contribution text; its temporary restriction on upstream external pull requests does not describe ClawDSH's contribution policy.

---

<!-- ⬇ Upstream CONTRIBUTING text (kept unchanged for attribution and rebases) -->

# Contributing

English | [中文](CONTRIBUTING.zh.md)

Thank you for your interest in contributing to DeepSeek Harness!

We deeply believe in the power of open source communities, and that belief has shaped this project from the very beginning.

DeepSeek Harness is still at an early stage and under active development. We are sorry that we cannot accept external pull requests at the moment. However, contributing code to this repository is far from the only way to help. There are many other ways to get involved:

- Identify and report issues or bugs in GitHub Discussions:
  - Upvote discussions that you would like to bring to the team's attention. We are a very small team and may not be able to reply to every post, but we monitor them and consider them when allocating resources.
- Contribute to the ecosystem:
  - Create a plugin that excites you and share it with others:
    - Associate your GitHub project with the `dsh-plugin` topic to help others discover your plugin.
  - Write blog posts and how-to guides about DeepSeek Harness.
  - Answer questions and help other members of the community.

DeepSeek Harness is designed to be deeply customizable. We do not believe that packages in the official repository are inherently more important than packages created by the community. You may consider this repository an idea, an official showcase, and a source of inspiration, but not a mandate from us.

We have already seen exciting projects emerge from the community, and we hope to see the ecosystem continue to grow in its own directions.

Into the unknown.
