import { Badge } from "@/components/ui/badge"
import { ElementCard } from "@/components/viz/ElementCard"

type BufferStripProps = {
  name: string
  values: number[]
  role?: "read" | "written"
  digits?: Array<number | null>
  showBinary?: boolean
  bitOffset?: number | null
  compact?: boolean
}

export function BufferStrip({ name, values, role, digits = [], showBinary = false, bitOffset = null, compact = false }: BufferStripProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm font-medium">
        <span>{name}</span>
        {role === "read" && <Badge variant="secondary">read</Badge>}
        {role === "written" && <Badge>written</Badge>}
      </div>
      <div className="flex flex-wrap gap-2">
        {values.map((value, i) => (
          <ElementCard
            key={`${name}-${i}-${value}`}
            value={value}
            index={i}
            digit={digits[i] ?? null}
            bitOffset={showBinary ? bitOffset : null}
            compact={compact}
          />
        ))}
      </div>
    </div>
  )
}
