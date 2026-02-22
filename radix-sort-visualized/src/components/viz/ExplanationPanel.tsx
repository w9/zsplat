import type { ReactNode } from "react"
import { Card, CardContent } from "@/components/ui/card"

type ExplanationPanelProps = {
  stepTitle?: string
  stepSubtitle?: string
  text: string
  controls?: ReactNode
  legend?: ReactNode
}

export function ExplanationPanel({ stepTitle, stepSubtitle, text, controls, legend }: ExplanationPanelProps) {
  return (
    <Card className="gap-0 py-0">
      <CardContent className="py-4">
        {controls && <div className="mb-3">{controls}</div>}
        {stepTitle && <div className="text-sm font-semibold text-slate-900">{stepTitle}</div>}
        {stepSubtitle && <div className="mb-2 text-xs text-slate-500">{stepSubtitle}</div>}
        <p className="text-sm text-slate-700">{text}</p>
        {legend && <div className="mt-3">{legend}</div>}
      </CardContent>
    </Card>
  )
}
