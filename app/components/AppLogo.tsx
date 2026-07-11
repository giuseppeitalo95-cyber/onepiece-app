'use client'

type AppLogoProps = {
  compact?: boolean
  className?: string
}

export default function AppLogo({ compact = false, className = '' }: AppLogoProps) {
  return (
    <div className={`opv-logo ${compact ? 'opv-logo-compact' : ''} ${className}`}>
      <div className="opv-hat-wrap">
        <img src="/luffyhatlogo.webp" alt="OPV" className="opv-hat" />
      </div>
      <div className="opv-logo-mark">
        <span className="opv-logo-text">OPV</span>
        <span className="opv-logo-shine" />
      </div>
    </div>
  )
}
