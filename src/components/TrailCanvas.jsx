export function TrailCanvas({ historyCanvasRef, sessionCanvasRef, glowCanvasRef }) {
  return (
    <>
      <canvas
        ref={glowCanvasRef}
        className="trail-glow"
        data-canvas-revision="0"
        aria-hidden="true"
      />
      <canvas
        ref={historyCanvasRef}
        className="trail trail-history"
        data-canvas-revision="0"
        aria-hidden="true"
      />
      <canvas
        ref={sessionCanvasRef}
        className="trail-session"
        data-canvas-revision="0"
        aria-hidden="true"
      />
    </>
  );
}
