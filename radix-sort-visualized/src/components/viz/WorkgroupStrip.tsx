import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { VIZ_TILE_SIZE, type WorkgroupTile } from "@/types/radix"

type WorkgroupStripProps = {
  keys: number[]
  digits: number[]
  tiles: WorkgroupTile[]
}

const DIGIT_BG = ["#a6cee344", "#1f78b444", "#b2df8a44", "#33a02c44"]

export function WorkgroupStrip({ keys, digits, tiles }: WorkgroupStripProps) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">keysIn partitioned into WG tiles (VIZ_TILE_SIZE={VIZ_TILE_SIZE})</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {tiles.map((tile) => (
          <div key={`wg-${tile.wg}`} className="space-y-1">
            <div className="text-xs font-medium text-slate-600">
              WG{tile.wg} reads indices {tile.start}..{Math.max(tile.start, tile.end - 1)}
            </div>
            <div className="flex flex-wrap gap-2 rounded border border-slate-200 bg-slate-50 p-2">
              {Array.from({ length: tile.end - tile.start }, (_, offset) => {
                const i = tile.start + offset
                return (
                  <div
                    key={`cell-${tile.wg}-${i}`}
                    className="rounded border border-slate-300 px-2 py-1 text-xs"
                    style={{ backgroundColor: DIGIT_BG[digits[i]] }}
                  >
                    <span className="font-semibold">{keys[i]}</span>
                    <span className="ml-1 text-slate-500">#{i}</span>
                    <span className="ml-1 text-slate-600">d={digits[i]}</span>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
