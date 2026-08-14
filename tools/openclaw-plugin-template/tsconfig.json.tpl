{
  // 复制自仓库 package 的惯例：继承仓库基座，并把本包注册到
  // packages/openclaw/tsconfig.json 的 references。OpenClaw 扩展包不注册到
  // 上游 tsconfig.host.json；测试由 packages/openclaw/tsconfig.check.json 检查。
  "extends": "../../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "lib/types"
  },
  "include": ["src"],
  "references": [
    { "path": "../../../vendor/cordis" },
    { "path": "../../runtime-diagnostics/invariants" }
  ]
}
