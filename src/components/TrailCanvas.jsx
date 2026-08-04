export function TrailCanvas({ canvasRef, glowCanvasRef }) {
  return (
    <>
      <canvas
        ref={glowCanvasRef}
        className="trail-glow"
        data-canvas-revision="0"
        aria-hidden="true"
      />
      <canvas
        ref={canvasRef}
        className="trail"
        data-canvas-revision="0"
        aria-hidden="true"
      />
    </>
  );
}
