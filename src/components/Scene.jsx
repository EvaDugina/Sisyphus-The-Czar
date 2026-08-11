import { Rock } from "./Rock";
import { RockImprint } from "./RockImprint";
import { TrailCanvas } from "./TrailCanvas";
import { WeatherRain } from "./WeatherRain";

export function Scene({ scene, trail, rain }) {
  return (
    <main
      ref={scene.worldRef}
      className="world"
      aria-label="Сцена The Path of Tzarey"
    >
      <TrailCanvas
        historyCanvasRef={trail.trailCanvasRef}
        sessionCanvasRef={trail.trailSessionCanvasRef}
        glowCanvasRef={trail.trailGlowCanvasRef}
      />
      <div
        className="summit-timer"
        data-testid="summit-timer"
        aria-hidden="true"
      >
        00:00:00
      </div>
      <section className="summit">
        <div className="target-zone" aria-hidden="true" />
        <h2 className="title2">miniature</h2>
        <h2 className="title">The Path of Tzarey</h2>
      </section>
      <WeatherRain
        layerRef={rain.rainLayerRef}
        fxCanvasRef={rain.rainFxCanvasRef}
        fallbackCanvasRef={rain.rainFallbackCanvasRef}
      />
      <RockImprint rockImprintRef={scene.rockImprintRef} />
      <Rock rockRef={scene.rockRef} />
      <div
        ref={scene.heightGateStatusRef}
        className="height-gate-status"
        data-testid="height-gate-status"
        role="status"
        aria-live="polite"
        aria-hidden="true"
        hidden
      />
      <div ref={scene.remoteCursorLayerRef} className="remote-cursors" aria-hidden="true" />
      <div ref={scene.handCursorRef} className="hand-cursor" aria-hidden="true" />
    </main>
  );
}
