import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

type InputControlsProps = {
  value: string
  onChange: (value: string) => void
  randomCount: number
  onRandomCountChange: (value: number) => void
  onRandomize: () => void
  onApply: () => void
}

export function InputControls({
  value,
  onChange,
  randomCount,
  onRandomCountChange,
  onRandomize,
  onApply,
}: InputControlsProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="e.g. 42, 17, 5, 93, 28..."
        className="min-w-80 flex-1 bg-white"
      />
      <Input
        type="number"
        min={1}
        max={256}
        value={randomCount}
        onChange={(e) => {
          const parsed = Number.parseInt(e.target.value, 10)
          if (Number.isFinite(parsed)) onRandomCountChange(parsed)
        }}
        className="w-28 bg-white"
        aria-label="Random input count"
      />
      <Button type="button" variant="outline" onClick={onRandomize}>
        Randomize
      </Button>
      <Button type="button" onClick={onApply}>
        Apply
      </Button>
    </div>
  )
}
