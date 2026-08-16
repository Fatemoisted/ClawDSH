# ClawDSH brand guide

English | [中文](README.zh.md)

![ClawDSH lockup](clawdsh-lockup.svg)

ClawDSH uses the **Tidal Claw**: a calm whale carries a small coral claw as its fin. The whale represents the dsh foundation and long-running agent work; the claw identifies the composable personal-assistant capabilities rebuilt by ClawDSH. The whale always remains the dominant form.

ClawDSH is an independent community project built on DeepSeek Harness and interoperating with OpenClaw. Its artwork is original and must not imply endorsement by either upstream project.

## Voice

The English positioning line is “OpenClaw capabilities, rebuilt as composable dsh plugins.” The Chinese positioning line is “把 OpenClaw 的个人助手能力，重建为可组合、可维护的 dsh 插件。” Product prose should be calm, direct, technically precise, and honest about capability status.

## Master artwork

| Asset | Purpose |
| --- | --- |
| `clawdsh-mark.svg` | Default full-color mark on transparent light or neutral surfaces |
| `clawdsh-lockup.svg` | Mark and outlined wordmark for documentation and wide layouts |
| `clawdsh-monochrome.svg` | Single-color mark for constrained reproduction |
| `clawdsh-maskable.svg` | Padded app icon with a fixed Foam field |
| `clawdsh-social-preview.png` | 1280×640 repository and link preview |

Do not alter the proportions, recolor individual parts, add gradients or shadows, rotate the mark, or detach the coral fin. Keep clear space around the mark equal to at least the eye-to-head distance. At sizes below 24 CSS pixels, use the mark rather than the lockup.

## Palette

| Token | Hex | Use |
| --- | --- | --- |
| Deep Ocean | `#071A2B` | Wordmark, dark surfaces, and high-contrast detail |
| Tidal Blue | `#1473E6` | Whale body and primary interaction accent |
| Coral Claw | `#F05A5B` | The claw and decorative emphasis only |
| Foam | `#F4FAFF` | Light surfaces and reverse artwork |

Coral Claw is decorative. Do not use it as the product error color or as the only signal for state. Text and controls must meet WCAG AA contrast in their actual UI context.

## Accessibility and motion

Supply the accessible name “ClawDSH” when the artwork is the only product label; use an empty alternative when adjacent text already names the product. Never encode capability state in the mark. Brand motion is optional, subtle, and disabled by `prefers-reduced-motion`.

## Production

The SVG files contain paths and primitive geometry only: no fonts, external references, embedded bitmaps, gradients, filters, scripts, or generator metadata. Regenerate the checked PNG derivatives and Web mirrors with:

```bash
node tools/render-clawdsh-brand.mjs
node tools/render-clawdsh-brand.mjs --check
```

The generated-image concept was used only to evaluate silhouette hierarchy. The checked vector artwork was redrawn from first principles and is the sole source of truth.
