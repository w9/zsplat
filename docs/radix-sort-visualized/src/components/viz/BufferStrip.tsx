import { Badge } from "@/components/ui/badge"
import { ElementCard } from "@/components/viz/ElementCard"
import type { WorkgroupTile } from "@/types/radix"

type BufferStripProps = {
  name: string
  values: number[]
  role?: "read" | "written"
  digits?: Array<number | null>
  showBinary?: boolean
  bitOffset?: number | null
  compact?: boolean
  workgroupTiles?: WorkgroupTile[]
}

export function BufferStrip({
  name,
  values,
  role,
  digits = [],
  showBinary = false,
  bitOffset = null,
  compact = false,
  workgroupTiles = [],
}: BufferStripProps) {
  const renderCard = (value: number, i: number) => (
    <ElementCard
      key={`${name}-${i}-${value}`}
      value={value}
      index={i}
      digit={digits[i] ?? null}
      bitOffset={showBinary ? bitOffset : null}
      compact={compact}
    />
  )

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm font-medium">
        <span>{name}</span>
        {role === "read" && <Badge variant="secondary">read</Badge>}
        {role === "written" && <Badge>written</Badge>}
      </div>
      {workgroupTiles.length > 0 ? (
        <div className="overflow-x-auto py-1">
          <div className="flex w-max items-start gap-2">
            {workgroupTiles.map((tile) => (
              <div
                key={`wg-tile-${tile.wg}-${tile.start}-${tile.end}`}
                className="rounded-md border-2 border-dashed border-slate-400 p-1 transition-all duration-300"
              >
                <div className="mb-1 text-[10px] font-medium text-slate-600">WG{tile.wg}</div>
                <div className="flex gap-2">
                  {Array.from({ length: Math.max(0, tile.end - tile.start) }, (_, offset) => {
                    const i = tile.start + offset
                    return renderCard(values[i], i)
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">{values.map((value, i) => renderCard(value, i))}</div>
      )}
    </div>
  )
}
