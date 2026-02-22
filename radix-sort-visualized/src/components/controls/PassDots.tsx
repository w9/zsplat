import { cn } from "@/lib/utils"

type PassDotsProps = {
  currentPass: number
  numPasses: number
}

export function PassDots({ currentPass, numPasses }: PassDotsProps) {
  return (
    <div className="flex items-center gap-2">
      {Array.from({ length: numPasses }).map((_, i) => (
        <span
          key={i}
          className={cn(
            "inline-block h-2.5 w-2.5 rounded-full",
            i < currentPass ? "bg-slate-700" : i === currentPass ? "bg-slate-500" : "bg-slate-300",
          )}
        />
      ))}
    </div>
  )
}
