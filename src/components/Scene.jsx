import { BirchLayer } from "./BirchLayer";
import { GlassStrips } from "./GlassStrips";
import { Rock } from "./Rock";
import { RockEchoTrail } from "./RockEchoTrail";
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
      <ol
        ref={scene.summitLeaderboardRef}
        className="summit-leaderboard"
        data-testid="summit-leaderboard"
        aria-label="Рейтинг удержания камня на вершине"
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
      <BirchLayer depth="behind" />
      <RockEchoTrail layerRef={trail.rockEchoTrailLayerRef} />
      <RockImprint rockImprintRef={scene.rockImprintRef} />
      <Rock rockRef={scene.rockRef} />
      <GlassStrips layerRef={scene.glassStripsRef} />
      <BirchLayer depth="front" />
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
