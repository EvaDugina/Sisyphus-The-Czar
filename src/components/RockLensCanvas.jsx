export function RockLensCanvas({ canvasRef }) {
  return (
    <canvas
      ref={canvasRef}
      className="rock-lens-canvas"
      data-testid="rock-lens-canvas"
      aria-hidden="true"
    />
  );
}
