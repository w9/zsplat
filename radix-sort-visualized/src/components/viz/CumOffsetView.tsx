type CumOffsetViewProps = {
  title: string
  values: number[][]
  sharedDigits?: number[][]
  valueLabel?: string
  highlightWorkgroup?: number | null
  onHoverWorkgroupChange?: (wg: number | null) => void
}

const DIGIT_STROKE = ["#a6cee3", "#1f78b4", "#b2df8a", "#33a02c"]

export function CumOffsetView({
  title,
  values,
  sharedDigits,
  valueLabel = "cumOffset[d]",
  highlightWorkgroup = null,
  onHoverWorkgroupChange,
}: CumOffsetViewProps) {
  const isHighlightedWG = (wg: number) => highlightWorkgroup == null || wg === highlightWorkgroup
  return (
    <div className="space-y-2">
      <div className="text-sm font-medium">{title}</div>
      <div className="flex flex-wrap gap-2">
        {values.map((wgOffsets, wg) => (
          <div
            key={`cum-${wg}`}
            className="rounded-md border-2 border-dashed border-slate-400 p-2"
            style={{ opacity: isHighlightedWG(wg) ? 1 : 0.2 }}
            onMouseEnter={() => onHoverWorkgroupChange?.(wg)}
            onMouseLeave={() => onHoverWorkgroupChange?.(null)}
          >
            <div className="mb-1 text-[10px] font-medium text-slate-600">WG{wg}</div>
            {sharedDigits?.[wg] && (
              <>
                <div className="mb-1 text-[10px] text-slate-500">sharedDigits[lid]</div>
                <div className="mb-2 flex flex-wrap gap-2">
                  {sharedDigits[wg].map((digit, lid) => {
                    const isValid = digit >= 0
                    const color = isValid ? (DIGIT_STROKE[digit] ?? "#cbd5e1") : "#cbd5e1"
                    return (
                      <div key={`sd-${wg}-${lid}`} className="flex flex-col items-center gap-1">
                        <div className="text-[10px] text-slate-500">{lid}</div>
                        <div
                          className="rounded border px-2 py-1 text-xs"
                          style={{
                            borderColor: color,
                            backgroundColor: isValid ? `${color}33` : "#ffffff",
                            opacity: isValid ? 1 : 0.5,
                          }}
                        >
                          <span className="font-semibold text-slate-800">{isValid ? digit : "idle"}</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </>
            )}
            <div className="mb-1 text-[10px] text-slate-500">{valueLabel}</div>
            <div className="flex flex-wrap gap-2">
              {wgOffsets.map((value, digit) => (
                <div key={`d-${wg}-${digit}`} className="flex flex-col items-center gap-1">
                  <div className="text-[10px] text-slate-500">{digit}</div>
                  <div
                    className="rounded border px-2 py-1 text-xs"
                    style={{
                      borderColor: DIGIT_STROKE[digit] ?? "#cbd5e1",
                      backgroundColor: `${DIGIT_STROKE[digit] ?? "#cbd5e1"}33`,
                    }}
                  >
                    <span className="font-semibold text-slate-800">{value}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
