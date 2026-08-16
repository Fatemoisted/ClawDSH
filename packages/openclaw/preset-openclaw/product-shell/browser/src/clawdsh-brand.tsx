import type { ReactNode } from 'react'

/** Public brand-mark asset mounted below the product base path. */
export const CLAWDSH_MARK_URL = '/clawdsh/brand/clawdsh-mark.svg'

interface ClawdshMarkProps {
  readonly className?: string | undefined
  readonly decorative?: boolean
}

/**
 * Render the ClawDSH mark with one consistent accessibility policy.
 * @param props - Optional styling hook and whether adjacent copy already names the product.
 * @returns The public SVG asset as an image.
 */
export function ClawdshMark({ className, decorative = true }: ClawdshMarkProps): ReactNode {
  return (
    <img
      className={className}
      src={CLAWDSH_MARK_URL}
      alt={decorative ? '' : 'ClawDSH'}
      aria-hidden={decorative ? true : undefined}
      draggable={false}
    />
  )
}
