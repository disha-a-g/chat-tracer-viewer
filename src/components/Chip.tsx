// One pill shape (padding, radius, font-size) for every small label/badge in
// the app — tool-name tags, filter chips, stat values, likelihood badges.
// Before this, each of those hand-rolled its own slightly different
// px/py/rounded/text-size combination; visually they're the same kind of
// thing (a short labeled fact), so they should look like it.

import type { ReactNode } from 'react'

export type ChipTone = 'neutral' | 'error' | 'warning' | 'success' | 'info'

interface ChipProps {
  children: ReactNode
  tone?: ChipTone
  /** Escape hatch for a color combo the tone presets don't cover (e.g. the
   *  four-level failure-likelihood scale, which needs an amber "medium"
   *  distinct from "low") — replaces the tone colors entirely rather than
   *  layering on top, since Tailwind class precedence isn't reliably
   *  determined by string order, only by generated-stylesheet order. */
  colorClassName?: string
  /** Renders as a button with a pressed/active look — omit for a static label. */
  active?: boolean
  onClick?: () => void
  title?: string
}

const TONE_CLASSES: Record<ChipTone, string> = {
  neutral: 'border-neutral-700 bg-neutral-900 text-neutral-300',
  error: 'border-red-500/30 bg-red-500/10 text-red-300',
  warning: 'border-amber-400/30 bg-amber-400/10 text-amber-300',
  success: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  info: 'border-sky-400/30 bg-sky-400/10 text-sky-300',
}

export function Chip({ children, tone = 'neutral', colorClassName, active, onClick, title }: ChipProps) {
  const colors = colorClassName ?? TONE_CLASSES[tone]
  const shape = `inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 font-mono text-[11px] leading-none transition-colors ${colors}`

  if (!onClick) {
    return (
      <span className={shape} title={title}>
        {children}
      </span>
    )
  }

  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`${shape} ${active ? 'ring-2 ring-current ring-offset-1 ring-offset-neutral-950' : 'opacity-75 hover:opacity-100'}`}
    >
      {children}
    </button>
  )
}
