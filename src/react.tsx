import { useEffect, useRef } from "react";
import { ZSplat, type ZSplatOptions } from "./ZSplat";

export type ZSplatViewProps = {
  url?: string;
  buffer?: ArrayBuffer;
  options?: ZSplatOptions;
  style?: React.CSSProperties;
  className?: string;
  onError?: (error: Error) => void;
};

export function ZSplatView({ url, buffer, options, style, className, onError }: ZSplatViewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const splatRef = useRef<ZSplat | null>(null);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    let active = true;

    const start = async () => {
      if (!canvasRef.current) {
        return;
      }
      try {
        const splat = new ZSplat(options);
        splatRef.current = splat;
        await splat.init(canvasRef.current);
        if (buffer) {
          await splat.loadPly(buffer);
        } else if (url) {
          const data = await fetch(url).then((res) => res.arrayBuffer());
          await splat.loadPly(data);
        }
        const loop = () => {
          if (!active) {
            return;
          }
          splat.render();
          frameRef.current = requestAnimationFrame(loop);
        };
        loop();
      } catch (error) {
        if (onError && error instanceof Error) {
          onError(error);
        }
      }
    };

    start();

    return () => {
      active = false;
      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current);
      }
      splatRef.current?.dispose();
      splatRef.current = null;
    };
  }, [url, buffer, options, onError]);

  return <canvas ref={canvasRef} className={className} style={style} />;
}
