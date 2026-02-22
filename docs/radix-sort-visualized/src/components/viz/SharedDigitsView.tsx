import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

type SharedDigitsViewProps = {
  wave: number
  waveDigits: number[][][]
  inputKeys: number[]
}

const DIGIT_BG = ["#a6cee344", "#1f78b444", "#b2df8a44", "#33a02c44"]

export function SharedDigitsView({ wave, waveDigits, inputKeys }: SharedDigitsViewProps) {
  const wgSize = waveDigits[0]?.[wave]?.length ?? 0
  const wavesPerTile = waveDigits[0]?.length ?? 0
  const tileSize = wgSize * wavesPerTile

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">sharedDigits (wave {wave})</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {waveDigits.map((wgWaves, wg) => (
          <div key={`shared-${wg}`} className="space-y-1">
            <div className="text-xs font-medium text-slate-600">WG{wg} keysIn (current wave highlighted)</div>
            <div className="flex flex-wrap gap-2 rounded border border-slate-200 bg-slate-50 p-2">
              {Array.from({ length: tileSize }, (_, offset) => {
                const idx = wg * tileSize + offset
                const inRange = idx < inputKeys.length
                const isWaveCell = wgSize > 0 && Math.floor(offset / wgSize) === wave
                const waveDigit = isWaveCell ? wgWaves[wave]?.[offset % wgSize] ?? -1 : -1
                return (
                  <div
                    key={`keysin-${wg}-${idx}`}
                    className="rounded border px-2 py-1 text-xs"
                    style={{
                      borderColor: isWaveCell ? "#334155" : "#cbd5e1",
                      backgroundColor: isWaveCell && waveDigit >= 0 ? DIGIT_BG[waveDigit] : "#ffffff",
                      opacity: inRange ? 1 : 0.45,
                    }}
                  >
                    <span className="font-semibold">{inRange ? inputKeys[idx] : "·"}</span>
                    <span className="ml-1 text-slate-500">#{idx}</span>
                  </div>
                )
              })}
            </div>
            <div className="text-xs font-medium text-slate-600">WG{wg} sharedDigits[lid]</div>
            <div className="flex gap-2">
              {wgWaves[wave]?.map((digit, lid) => (
                <div
                  key={`digit-${wg}-${lid}`}
                  className="min-w-20 rounded border border-slate-300 px-2 py-1 text-xs"
                  style={{ backgroundColor: digit >= 0 ? DIGIT_BG[digit] : "#f8fafc" }}
                >
                  <span className="text-slate-500">lid {lid}</span>
                  <div className="font-semibold">{digit >= 0 ? `digit ${digit}` : "idle"}</div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
