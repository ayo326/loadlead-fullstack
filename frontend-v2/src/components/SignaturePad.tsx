import { useRef, useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { RotateCcw, Check } from "lucide-react";

interface SignaturePadProps {
  onSave: (dataUrl: string) => void;
  existingSignature?: string;
  disabled?: boolean;
  label?: string;
}

export function SignaturePad({ onSave, existingSignature, disabled, label }: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [drawing, setDrawing] = useState(false);
  const [hasStrokes, setHasStrokes] = useState(false);
  const [saved, setSaved] = useState(false);
  const lastPos = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    ctx.strokeStyle = "#1e3a5f";
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    if (existingSignature) {
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0);
      img.src = existingSignature;
      setHasStrokes(true);
      setSaved(true);
    }
  }, [existingSignature]);

  const getPos = (e: React.MouseEvent | React.TouchEvent, canvas: HTMLCanvasElement) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    if ("touches" in e) {
      const touch = e.touches[0];
      return { x: (touch.clientX - rect.left) * scaleX, y: (touch.clientY - rect.top) * scaleY };
    }
    return { x: ((e as React.MouseEvent).clientX - rect.left) * scaleX, y: ((e as React.MouseEvent).clientY - rect.top) * scaleY };
  };

  const startDraw = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (disabled || saved) return;
    e.preventDefault();
    const canvas = canvasRef.current!;
    const pos = getPos(e, canvas);
    lastPos.current = pos;
    setDrawing(true);
    setHasStrokes(true);
  }, [disabled, saved]);

  const draw = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (!drawing || disabled || saved) return;
    e.preventDefault();
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    const pos = getPos(e, canvas);
    if (lastPos.current) {
      ctx.beginPath();
      ctx.moveTo(lastPos.current.x, lastPos.current.y);
      ctx.lineTo(pos.x, pos.y);
      ctx.stroke();
    }
    lastPos.current = pos;
  }, [drawing, disabled, saved]);

  const endDraw = useCallback(() => {
    setDrawing(false);
    lastPos.current = null;
  }, []);

  const clear = () => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasStrokes(false);
    setSaved(false);
  };

  const save = () => {
    const canvas = canvasRef.current!;
    const dataUrl = canvas.toDataURL("image/png");
    onSave(dataUrl);
    setSaved(true);
  };

  return (
    <div className="space-y-2">
      {label && <p className="text-sm font-medium text-foreground">{label}</p>}
      <div className={`relative border-2 rounded-lg overflow-hidden ${saved ? "border-green-400 bg-green-50" : "border-dashed border-border bg-muted/30"} ${disabled ? "opacity-50" : ""}`}>
        <canvas
          ref={canvasRef}
          width={600}
          height={150}
          className="w-full cursor-crosshair touch-none"
          style={{ height: "120px" }}
          onMouseDown={startDraw}
          onMouseMove={draw}
          onMouseUp={endDraw}
          onMouseLeave={endDraw}
          onTouchStart={startDraw}
          onTouchMove={draw}
          onTouchEnd={endDraw}
        />
        {!hasStrokes && !disabled && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <p className="text-sm text-muted-foreground">Sign here</p>
          </div>
        )}
        {saved && (
          <div className="absolute top-2 right-2 bg-green-500 text-white rounded-full p-0.5">
            <Check className="h-3 w-3" />
          </div>
        )}
      </div>
      {!disabled && (
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={clear} disabled={!hasStrokes || saved}>
            <RotateCcw className="h-3 w-3 mr-1" /> Clear
          </Button>
          <Button type="button" size="sm" onClick={save} disabled={!hasStrokes || saved}>
            <Check className="h-3 w-3 mr-1" /> {saved ? "Signed" : "Confirm Signature"}
          </Button>
        </div>
      )}
    </div>
  );
}
