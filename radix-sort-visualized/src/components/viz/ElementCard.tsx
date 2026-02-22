import { cn } from "@/lib/utils"

const DIGIT_COLORS = ["#a6cee3", "#1f78b4", "#b2df8a", "#33a02c"]

function toBinary8(value: number): string {
  let out = ""
  for (let i = 7; i >= 0; i--) out += (value >> i) & 1 ? "1" : "0"
  return out
}

type ElementCardProps = {
  value: number
  metaValue?: number | null
  digit?: number | null
  bitOffset?: number | null
  compact?: boolean
  showDigitLabel?: boolean
}

export function ElementCard({
  value,
  metaValue = null,
  digit = null,
  bitOffset = null,
  compact = false,
  showDigitLabel = true,
}: ElementCardProps) {
  const d = digit ?? -1
  const borderColor = d >= 0 ? DIGIT_COLORS[d] : "#cbd5e1"
  const bgColor = d >= 0 ? `${DIGIT_COLORS[d]}33` : "#ffffff"
  const binary = toBinary8(value)

  return (
    <div
      className={cn(
        "relative rounded-md border-2 px-2 py-1 text-center shadow-sm",
        compact ? "w-16" : "w-20",
      )}
      style={{ borderColor, backgroundColor: bgColor }}
    >
      <div className="text-lg font-semibold leading-none">{value}</div>
      {metaValue != null && <div className="mt-1 text-[10px] text-slate-500">v={metaValue}</div>}
      {!compact && (
        <div className="mt-1 font-mono text-[10px] text-slate-600">
          {binary.split("").map((ch, i) => {
            const start = bitOffset == null ? 0 : 8 - bitOffset - 2
            const active = bitOffset != null && i >= start && i < start + 2
            return (
              <span key={`${i}-${ch}`} className={active ? "bg-slate-800 text-white" : ""}>
                {ch}
              </span>
            )
          })}
        </div>
      )}
      {showDigitLabel && d >= 0 && <div className="mt-1 text-[10px] font-semibold text-slate-700">d={d}</div>}
    </div>
  )
}
