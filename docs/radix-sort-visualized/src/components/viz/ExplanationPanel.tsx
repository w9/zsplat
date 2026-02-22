import { Card, CardContent } from "@/components/ui/card"

type ExplanationPanelProps = {
  stepTitle?: string
  stepSubtitle?: string
  text: string
}

export function ExplanationPanel({ stepTitle, stepSubtitle, text }: ExplanationPanelProps) {
  return (
    <Card className="gap-0 py-0">
      <CardContent className="py-4">
        {stepTitle && <div className="text-sm font-semibold text-slate-900">{stepTitle}</div>}
        {stepSubtitle && <div className="mb-2 text-xs text-slate-500">{stepSubtitle}</div>}
        <p className="text-sm text-slate-700">{text}</p>
      </CardContent>
    </Card>
  )
}
