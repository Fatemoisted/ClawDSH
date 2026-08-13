{
  "name": "@clawdsh/dsh-<pkg-name>",
  "description": "<一句话：这个插件贡献什么能力，替换/扩展哪个 seam>",
  "version": "0.1.0",
  "license": "MIT",
  "private": true,
  "type": "module",
  "main": "lib/index.js",
  "types": "lib/types/index.d.ts",
  "exports": {
    ".": {
      "types": "./lib/types/index.d.ts",
      "default": "./lib/index.js"
    },
    "./src/*": "./src/*",
    "./package.json": "./package.json"
  },
  "files": [
    "lib/index.js",
    "lib/types/**/*.d.ts"
  ],
  "dependencies": {
    "@deepseek-ai/cordis": "workspace:^"
  },
  "peerDependencies": {
    "@deepseek-ai/dsh-<依赖的 seam 包>": "workspace:^"
  },
  "devDependencies": {
    "@deepseek-ai/tsconfig": "workspace:^"
  }
}
