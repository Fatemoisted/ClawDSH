{
  // 复制自上游 packages/*/tsconfig.json 的惯例：继承仓库基座。
  // 注意：新包必须注册进 tsconfig.host.json（或 client 聚合）的 references，
  // 且只注册到一个聚合——见 docs/development.md 的 workspace 规则。
  "extends": "../../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "lib"
  },
  "include": ["src"]
}
