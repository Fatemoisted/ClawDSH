# ClawDSH assembly

English | [中文](README.zh.md)

This directory is ClawDSH's assembly layer. It composes dsh capabilities with the `packages/openclaw/*` plugins into a personal assistant through profile, bundle, preset, and patch mechanisms without modifying upstream source. The physical `preset-openclaw` directory name remains an internal repository exception; installed ids and product copy use `clawdsh`.

The OpenClaw counterpart is the overall personal-assistant combination of gateway, channels, Soul, Memory, Skills, and Automation.

The directory is not a plugin. It supplies:

1. the `clawdsh` agent preset (`preset.yml`, `agent.cordis.yml`, and `souls/assistant.md`), displayed as `ClawDSH 模式` and installed under the dsh user preset root;
2. the `clawdsh` profile template (`profile/`), which composes `dsh-base` and `dsh-web-app` with the ClawDSH Host plugins;
3. the development installer `tools/link-clawdsh.sh`, which installs the profile and preset and links the local `@clawdsh/*` packages.

The clean-install profile keeps Feishu, Telegram, and Automation disabled. It can therefore boot the stock dsh Web GUI without their credentials. Memory and Skills Hub remain enabled; Ark Embeddings resolves `ARK_API_KEY` only when an embedding call needs it. These three optional features temporarily use Loader `disabled` rows. The capability Settings increment replaces that mechanism with mounted business plugins whose `enabled` settings control runtime behavior.

## Local development

```bash
tools/link-clawdsh.sh
pnpm dsh --profile clawdsh
```

New Sessions default to the `clawdsh` preset shown as `ClawDSH 模式`. A model credential is needed only when a conversation makes a model request; the Web Host itself starts without external credentials.

## Temporary feature opt-in

Until capability Settings ships, use a later `--patch` overlay to enable optional behavior. The following rows are independent: remove every capability you do not intend to run, and replace the example Automation rule before use. Feishu keeps its profile-supplied environment references; Telegram and Automation need their complete Config in this later layer because an id-targeted patch replaces each supplied field.

```yaml
- id: channel-feishu
  disabled: false

- id: channel-telegram
  disabled: false
  config:
    botToken: !!js process.env.TELEGRAM_BOT_TOKEN

- id: automation
  disabled: false
  config:
    rules:
      - id: daily-check-in
        schedule:
          kind: cron
          expr: "0 9 * * *"
        message: Review today's priorities.
```

Save the selected rows as `clawdsh-enable.cordis.yml`. Supply credentials only for enabled channels, then inspect the effective composition or start it:

```bash
pnpm dsh --profile clawdsh --patch ./clawdsh-enable.cordis.yml --dump-config
pnpm dsh --profile clawdsh --patch ./clawdsh-enable.cordis.yml
```

A disabled row may omit credentials. Once enabled, the owning plugin fails at its earliest validation point when required configuration is absent. The Feishu row reads `FEISHU_APP_ID` and `FEISHU_APP_SECRET`; the Telegram example reads `TELEGRAM_BOT_TOKEN`.

`tools/link-clawdsh.sh` warns when it finds the legacy `openclaw` profile or preset and leaves those assets untouched. It creates no compatibility alias and does not migrate or delete user data. Review any legacy `agent-presets.default` override in `$DSH_HOME/settings.yaml` before removing the old preset.

The preset currently lives in dsh's user preset root because the launcher exposes no installation-owned ClawDSH preset root. The ClawDSH product Settings page will not offer a delete action, but Harness Advanced still treats it as a user preset and can delete it. The public-distribution CLI owns `clawdsh doctor`, the managed-install manifest, integrity checks, and explicit repair; until then, rerunning the development installer restores the checked-in preset files.

The target product shell, capability Settings, Activity view, and Harness Advanced route are specified in [the local GUI feature spec](../../../docs/specs/feature-gui-web.md).
