import { Badge } from "@/components/ui/badge"

type StepHeaderProps = {
  stepName: string
  subtitle: string
  stepProgress: string
  passLabel: string
}

export function StepHeader({ stepName, subtitle, stepProgress, passLabel }: StepHeaderProps) {
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-xl font-semibold">{stepName}</h2>
        <Badge variant="secondary">{passLabel}</Badge>
        <Badge variant="outline">{stepProgress}</Badge>
      </div>
      <p className="text-sm text-slate-600">{subtitle}</p>
    </div>
  )
}
