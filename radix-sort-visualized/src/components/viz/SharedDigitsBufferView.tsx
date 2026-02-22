type SharedDigitsBufferViewProps = {
  title: string
  values: number[][]
}

const DIGIT_STROKE = ["#a6cee3", "#1f78b4", "#b2df8a", "#33a02c"]

export function SharedDigitsBufferView({ title, values }: SharedDigitsBufferViewProps) {
  return (
    <div className="space-y-2">
      <div className="text-sm font-medium">{title}</div>
      <div className="flex flex-wrap gap-2">
        {values.map((wgDigits, wg) => (
          <div key={`shared-${wg}`} className="rounded-md border-2 border-dashed border-slate-400 p-2">
            <div className="mb-1 text-[10px] font-medium text-slate-600">WG{wg}</div>
            <div className="flex flex-wrap gap-2">
              {wgDigits.map((digit, lid) => (
                (() => {
                  const isValid = digit >= 0
                  const color = isValid ? (DIGIT_STROKE[digit] ?? "#cbd5e1") : "#cbd5e1"
                  return (
                <div
                  key={`lid-${wg}-${lid}`}
                  className="rounded border px-2 py-1 text-xs"
                  style={{
                    borderColor: color,
                    backgroundColor: isValid ? `${color}33` : "#ffffff",
                    opacity: isValid ? 1 : 0.5,
                  }}
                >
                  <div className="text-slate-500">lid {lid}</div>
                  <div className="font-semibold text-slate-800">{isValid ? digit : "idle"}</div>
                </div>
                  )
                })()
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
