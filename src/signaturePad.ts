/** Canvas signature pad for mouse / touch / stylus input. */

export class SignaturePad {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private drawing = false;
  private lastX = 0;
  private lastY = 0;
  private strokes = 0;
  private readonly onPointerDown: (event: PointerEvent) => void;
  private readonly onPointerMove: (event: PointerEvent) => void;
  private readonly onPointerUp: (event: PointerEvent) => void;
  private readonly onResize: () => void;

  constructor(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("2D-Kontext für Signatur-Canvas nicht verfügbar.");
    }
    this.canvas = canvas;
    this.ctx = ctx;

    this.onPointerDown = (event) => this.handlePointerDown(event);
    this.onPointerMove = (event) => this.handlePointerMove(event);
    this.onPointerUp = (event) => this.handlePointerUp(event);
    this.onResize = () => this.resize();

    canvas.addEventListener("pointerdown", this.onPointerDown);
    canvas.addEventListener("pointermove", this.onPointerMove);
    canvas.addEventListener("pointerup", this.onPointerUp);
    canvas.addEventListener("pointercancel", this.onPointerUp);
    canvas.addEventListener("pointerleave", this.onPointerUp);
    window.addEventListener("resize", this.onResize);

    this.resize();
  }

  destroy(): void {
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.removeEventListener("pointerup", this.onPointerUp);
    this.canvas.removeEventListener("pointercancel", this.onPointerUp);
    this.canvas.removeEventListener("pointerleave", this.onPointerUp);
    window.removeEventListener("resize", this.onResize);
  }

  clear(): void {
    const { width, height } = this.canvas;
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, width, height);
    this.applyDrawingStyle();
    this.strokes = 0;
  }

  isEmpty(): boolean {
    return this.strokes === 0;
  }

  toDataURL(type = "image/png"): string {
    return this.canvas.toDataURL(type);
  }

  private resize(): void {
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    const rect = this.canvas.getBoundingClientRect();
    const cssWidth = Math.max(Math.floor(rect.width), 1);
    const cssHeight = Math.max(Math.floor(rect.height), 1);
    const snapshot = this.strokes > 0 ? this.canvas.toDataURL("image/png") : null;

    this.canvas.width = Math.floor(cssWidth * ratio);
    this.canvas.height = Math.floor(cssHeight * ratio);
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.scale(ratio, ratio);
    this.applyDrawingStyle();

    if (snapshot) {
      const image = new Image();
      image.onload = () => {
        this.ctx.drawImage(image, 0, 0, cssWidth, cssHeight);
      };
      image.src = snapshot;
    }
  }

  private applyDrawingStyle(): void {
    this.ctx.lineCap = "round";
    this.ctx.lineJoin = "round";
    this.ctx.strokeStyle = "#111111";
    this.ctx.lineWidth = 2;
  }

  private pointerPosition(event: PointerEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  }

  private handlePointerDown(event: PointerEvent): void {
    event.preventDefault();
    this.canvas.setPointerCapture(event.pointerId);
    this.drawing = true;
    const pos = this.pointerPosition(event);
    this.lastX = pos.x;
    this.lastY = pos.y;
    this.ctx.beginPath();
    this.ctx.moveTo(pos.x, pos.y);
    this.ctx.lineTo(pos.x, pos.y);
    this.ctx.stroke();
    this.strokes += 1;
  }

  private handlePointerMove(event: PointerEvent): void {
    if (!this.drawing) {
      return;
    }
    event.preventDefault();
    const pos = this.pointerPosition(event);
    this.ctx.beginPath();
    this.ctx.moveTo(this.lastX, this.lastY);
    this.ctx.lineTo(pos.x, pos.y);
    this.ctx.stroke();
    this.lastX = pos.x;
    this.lastY = pos.y;
  }

  private handlePointerUp(event: PointerEvent): void {
    if (!this.drawing) {
      return;
    }
    this.drawing = false;
    if (this.canvas.hasPointerCapture(event.pointerId)) {
      this.canvas.releasePointerCapture(event.pointerId);
    }
  }
}
