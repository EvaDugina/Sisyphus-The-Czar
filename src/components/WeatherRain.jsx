export function WeatherRain({ layerRef, fxCanvasRef, fallbackCanvasRef }) {
  return (
    <div
      ref={layerRef}
      className="weather-rain"
      data-testid="weather-rain"
      aria-hidden="true"
    >
      <div className="weather-rain__blur" />
      <canvas
        ref={fxCanvasRef}
        className="weather-rain__canvas weather-rain__canvas--fx"
      />
      <canvas
        ref={fallbackCanvasRef}
        className="weather-rain__canvas weather-rain__canvas--fallback"
      />
    </div>
  );
}
