import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

type InputControlsProps = {
  value: string
  onChange: (value: string) => void
  onRandomize: () => void
  onApply: () => void
}

export function InputControls({ value, onChange, onRandomize, onApply }: InputControlsProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="e.g. 42, 17, 5, 93, 28..."
        className="min-w-80 flex-1 bg-white"
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
