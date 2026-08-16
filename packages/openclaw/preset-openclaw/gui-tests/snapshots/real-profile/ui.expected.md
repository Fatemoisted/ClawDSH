# Native sidebar footer

- link "Harness 高级":
  - /url: /
  - img
  - text: Harness 高级

# Native settings default section

- button "ClawDSH":
  - img
  - text: ClawDSH

# Feature status

- region "功能状态":
  - heading "功能状态" [level=2]
  - paragraph: “已启用”表示组件已装载且运行开关生效，不代表每次实际调用已验证；不主动执行远端探针。
  - text: 3 项已启用 · 2 项未启用 · 1 个配置提醒
  - list:
    - listitem:
      - strong: Soul
      - text: 新会话启用
      - paragraph: 修改只影响后续新会话。
    - listitem:
      - strong: Memory
      - text: 已启用
      - paragraph: 长期记忆工具已加载，本地存储会在首次读写时验证；语义搜索待配置。
    - listitem:
      - strong: Skills Hub
      - text: 来源已启用
      - paragraph: 已启用 ClawHub 兼容目录来源；是否从该来源发现 Skill 会在实际目录扫描时确认。
    - listitem:
      - strong: Channels
      - text: 尚未连接平台
      - paragraph: Protocol 与 Agent Bridge 就绪；Gateway 为避免未授权外联而未启用。
    - listitem:
      - strong: 自动任务
      - text: 尚未设置
      - paragraph: 还没有创建自动任务；这不影响正常对话。

# Conversation views

- tablist:
  - tab "对话" [selected]
  - tab "轨迹"
  - tab "ClawDSH 记录"

# ClawDSH records

- article:
  - text: 身份与上下文
  - heading "已准备本轮 ClawDSH 上下文" [level=3]
  - time: 2026年8月15日 20:00:00
  - list:
    - listitem: 已应用 ClawDSH 助手身份。
    - listitem: 已向 Agent 提供记忆使用说明；这不代表已读取或写入记忆。
  - group: 技术详情

# Unknown product page

- heading "页面不存在" [level=1]
