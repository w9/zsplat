import { Button } from "@/components/ui/button"
import { PassDots } from "@/components/controls/PassDots"

type StepControlsProps = {
  currentPass: number
  numPasses: number
  passText: string
  onReset: () => void
  onPrev: () => void
  onNext: () => void
  onEnd: () => void
}

export function StepControls({
  currentPass,
  numPasses,
  passText,
  onReset,
  onPrev,
  onNext,
  onEnd,
}: StepControlsProps) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-2">
        <PassDots currentPass={currentPass} numPasses={numPasses} />
        <span className="text-sm text-slate-600">{passText}</span>
      </div>
      <div className="ml-auto flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onReset} title="Home">
          Reset (Home)
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={onPrev} title="ArrowLeft">
          Prev (←)
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={onNext} title="ArrowRight">
          Next (→)
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={onEnd} title="End">
          End (End)
        </Button>
      </div>
    </div>
  )
}
