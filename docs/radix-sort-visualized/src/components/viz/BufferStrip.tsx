import { ElementCard } from "@/components/viz/ElementCard"
import type { WorkgroupTile } from "@/types/radix"

type BufferStripProps = {
  name: string
  values: number[]
  metaValues?: Array<number | null>
  role?: "read" | "written"
  digits?: Array<number | null>
  showBinary?: boolean
  bitOffset?: number | null
  compact?: boolean
  workgroupTiles?: WorkgroupTile[]
  highlightWorkgroup?: number | null
  onHoverWorkgroupChange?: (wg: number | null) => void
  workgroupIndex?: number | null
  getWorkgroupForIndex?: (index: number) => number | null
  showIndices?: boolean
  showDigitLabel?: boolean
}

export function BufferStrip({
  name,
  values,
  metaValues = [],
  role,
  digits = [],
  showBinary = false,
  bitOffset = null,
  compact = false,
  workgroupTiles = [],
  highlightWorkgroup = null,
  onHoverWorkgroupChange,
  workgroupIndex = null,
  getWorkgroupForIndex,
  showIndices = true,
  showDigitLabel = true,
}: BufferStripProps) {
  const isHighlightedWG = (wg: number | null) => highlightWorkgroup == null || wg == null || wg === highlightWorkgroup
  const useTileHover = workgroupTiles.length > 0
  const cardWG = (i: number) => {
    if (getWorkgroupForIndex) return getWorkgroupForIndex(i)
    if (workgroupIndex != null) return workgroupIndex
    return null
  }
  const renderCard = (value: number, i: number) => {
    const wg = cardWG(i)
    return (
      <div
        key={`${name}-${i}-${value}`}
        className="flex flex-col items-center gap-1"
        style={{ opacity: isHighlightedWG(wg) ? 1 : 0.2 }}
        onMouseEnter={() => {
          if (!useTileHover) onHoverWorkgroupChange?.(wg)
        }}
        onMouseLeave={() => {
          if (!useTileHover) onHoverWorkgroupChange?.(null)
        }}
      >
        {showIndices && <div className="text-[10px] text-slate-500">{i}</div>}
        <ElementCard
          value={value}
          metaValue={metaValues[i] ?? null}
          digit={digits[i] ?? null}
          bitOffset={showBinary ? bitOffset : null}
          compact={compact}
          showDigitLabel={showDigitLabel}
        />
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm font-medium">
        <span>{name}</span>
      </div>
      {workgroupTiles.length > 0 ? (
        <div className="overflow-x-auto py-1">
          <div className="flex w-max items-start gap-2">
            {workgroupTiles.map((tile) => (
              <div
                key={`wg-tile-${tile.wg}-${tile.start}-${tile.end}`}
                className="rounded-md border-2 border-dashed border-slate-400 p-1"
                style={{ opacity: isHighlightedWG(tile.wg) ? 1 : 0.2 }}
                onMouseEnter={() => onHoverWorkgroupChange?.(tile.wg)}
                onMouseLeave={() => onHoverWorkgroupChange?.(null)}
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
