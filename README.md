# ClawDSH

> **OpenClaw 的个人助手功能集，重建于 DeepSeek Harness (dsh) 的 Cordis 插件底盘之上。**
>
> 项目目的与实施方案：[docs/specs/roadmap.md](docs/specs/roadmap.md) · 架构决策：[docs/adr/](docs/adr/) · 功能对齐矩阵：[docs/matrix/parity.md](docs/matrix/parity.md)
>
> 本仓库跟踪上游 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)（git 远程 `upstream`），上游代码只读；自有代码仅位于 `packages/openclaw/`、`docs/{adr,specs,matrix,standards,journal}/`、`tools/`、`.github/workflows/clawdsh-*`。

---

<!-- ⬇ 以下为上游 README 原文（勿改；rebase 冲突时以 upstream 为准） -->

# DeepSeek Harness

English | [中文](README.zh.md)

DeepSeek Harness (`dsh`) is an open-source agent harness developed by [DeepSeek AI](https://deepseek.com).

It uses an architecture where **everything is a plugin**, and is powered by [Cordis](https://github.com/cordiverse/cordis), whose design is described in [_A Programming Paradigm for Spatiotemporal Composability_](https://github.com/cordiverse/paper).

## Developer preview

DeepSeek Harness is currently in _developer preview_ and is iterating rapidly. **THERE WILL BE COMPATIBILITY-BREAKING CHANGES.**

## Run

### Run from `npm`

Install `Node.js`, then run:

```sh
npx @deepseek-ai/dsh web
```

The command starts the Web UI, served at `http://127.0.0.1:3080` by default. See [Web UI guide](docs/user/guide/index.md).

### Run from source

To run from a repository checkout:

```sh
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
pnpm install
pnpm run build
pnpm dsh web
```

## Community and support

- Feel free to submit feedback or bug reports through [GitHub Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions).
- Add the [`dsh-plugin`](https://github.com/topics/dsh-plugin) topic to your plugin repository for discoverability.
- Join <a href="https://discord.gg/Ycq5dCaS4">DeepSeek Harness Discord community</a>.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Development

Start with the [development guide](docs/development.md) and [architecture documentation](docs/architecture.md).

For agents, follow [AGENTS.md](AGENTS.md).

## License

[MIT](LICENSE)

Third-party dependencies and their licenses are disclosed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
