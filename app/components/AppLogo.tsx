'use client'

type AppLogoProps = {
  compact?: boolean
  className?: string
}

export default function AppLogo({ compact = false, className = '' }: AppLogoProps) {
  return (
    <div className={`opv-logo ${compact ? 'opv-logo-compact' : ''} ${className}`}>
      <img src="/opv-hat-cutout.png" alt="" className="opv-logo-hat" aria-hidden="true" />
      <img src="/opv-text-cutout.png" alt="OPV" className="opv-logo-text-img" />
    </div>
  )
}
