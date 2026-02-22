import { Button } from "@/components/ui/button"
import { PassDots } from "@/components/controls/PassDots"

type StepControlsProps = {
  currentPass: number
  numPasses: number
  stepProgress: string
  onReset: () => void
  onPrev: () => void
  onNext: () => void
  onEnd: () => void
}

export function StepControls({
  currentPass,
  numPasses,
  stepProgress,
  onReset,
  onPrev,
  onNext,
  onEnd,
}: StepControlsProps) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <PassDots currentPass={currentPass} numPasses={numPasses} />
      <span className="text-sm text-slate-600">{stepProgress}</span>
      <div className="ml-auto flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onReset}>
          Reset
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={onPrev}>
          Prev
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={onNext}>
          Next
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={onEnd}>
          End
        </Button>
      </div>
    </div>
  )
}
