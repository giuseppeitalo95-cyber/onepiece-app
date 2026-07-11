type AppLogoProps = {
  compact?: boolean
}

export default function AppLogo({ compact = false }: AppLogoProps) {
  return (
    <div className="flex flex-col items-center justify-center leading-none">
      <img
        src="/luffyhatlogo.webp"
        alt="Cappello di Luffy"
        className={
          compact
            ? 'h-7 w-auto shrink-0 object-contain'
            : 'h-12 w-auto shrink-0 object-contain'
        }
      />

      <span
        className={
          compact
            ? 'mt-0.5 whitespace-nowrap bg-gradient-to-r from-amber-200 via-yellow-400 to-amber-500 bg-clip-text text-base font-extrabold tracking-[0.18em] text-transparent'
            : 'mt-1 whitespace-nowrap bg-gradient-to-r from-amber-200 via-yellow-400 to-amber-500 bg-clip-text text-2xl font-extrabold tracking-[0.25em] text-transparent'
        }
      >
        OPV
      </span>
    </div>
  )
}