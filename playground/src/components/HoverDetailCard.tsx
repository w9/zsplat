import type { SplatData } from 'zsplat';
import { CardContent } from '@/components/ui/card';

const ROW_CLASS = 'flex justify-between gap-4 text-xs leading-6 text-muted-foreground/90';

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(4);
}

function getSplatProperties(data: SplatData, index: number) {
  if (index < 0 || index >= data.count) return null;
  const i = index;
  return {
    position: [data.positions[i * 3], data.positions[i * 3 + 1], data.positions[i * 3 + 2]] as const,
    rotation: [data.rotations[i * 4], data.rotations[i * 4 + 1], data.rotations[i * 4 + 2], data.rotations[i * 4 + 3]] as const,
    scale: [data.scales[i * 3], data.scales[i * 3 + 1], data.scales[i * 3 + 2]] as const,
    color: [data.colors[i * 4], data.colors[i * 4 + 1], data.colors[i * 4 + 2], data.colors[i * 4 + 3]] as const,
  };
}

export function HoverDetailCard({
  hoveredSplatIndex,
  splatData,
}: {
  hoveredSplatIndex: number | null;
  splatData: SplatData | null;
}) {
  const props = hoveredSplatIndex != null && splatData ? getSplatProperties(splatData, hoveredSplatIndex) : null;

  return (
    <CardContent className="pt-2.5 pb-1.5 pl-3 pr-3 text-muted-foreground/90 shrink-0">
        <div className="grid gap-0.5">
          {hoveredSplatIndex == null ? (
            <p className="text-xs text-muted-foreground/80 leading-relaxed">
              Hover over a splat in the scene to see its ID and properties.
            </p>
          ) : (
            <>
              <div className={ROW_CLASS}>
                <span>ID</span>
                <span className="tabular-nums">{hoveredSplatIndex}</span>
              </div>
          {props ? (
            <>
              <div className={ROW_CLASS}>
                <span>Position</span>
                <span className="tabular-nums font-mono text-[11px]">
                  {fmt(props.position[0])}, {fmt(props.position[1])}, {fmt(props.position[2])}
                </span>
              </div>
              <div className={ROW_CLASS}>
                <span>Rotation</span>
                <span className="tabular-nums font-mono text-[11px]">
                  {fmt(props.rotation[0])}, {fmt(props.rotation[1])}, {fmt(props.rotation[2])}, {fmt(props.rotation[3])}
                </span>
              </div>
              <div className={ROW_CLASS}>
                <span>Scale</span>
                <span className="tabular-nums font-mono text-[11px]">
                  {fmt(props.scale[0])}, {fmt(props.scale[1])}, {fmt(props.scale[2])}
                </span>
              </div>
              <div className={ROW_CLASS}>
                <span>Color</span>
                <span className="tabular-nums font-mono text-[11px]">
                  {fmt(props.color[0])}, {fmt(props.color[1])}, {fmt(props.color[2])}, {fmt(props.color[3])}
                </span>
              </div>
            </>
          ) : splatData ? (
            <div className={ROW_CLASS}>
              <span>Properties</span>
              <span>—</span>
            </div>
          ) : null}
            </>
          )}
        </div>
      </CardContent>
  );
}
