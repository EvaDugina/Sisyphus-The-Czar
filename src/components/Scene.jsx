import { Rock } from "./Rock";
import { RockImprint } from "./RockImprint";
import { TrailCanvas } from "./TrailCanvas";
import { WeatherRain } from "./WeatherRain";

export function Scene({ scene, trail, rain }) {
  return (
    <main ref={scene.worldRef} className="world" aria-label="Сцена Пути Царей">
      <TrailCanvas canvasRef={trail.trailCanvasRef} />
      <h1 className="top-inscription">СМЕРТИЮ СМЕРТЬ ПОПРАВ</h1>
      <section className="summit">
        <div className="target-zone" aria-hidden="true" />
        <h2 className="title2">Миниатюра</h2>
        <h2 className="title">ПУТЬ ЦАРЕЙ</h2>
      </section>
      <WeatherRain
        layerRef={rain.rainLayerRef}
        fxCanvasRef={rain.rainFxCanvasRef}
        fallbackCanvasRef={rain.rainFallbackCanvasRef}
      />
      <RockImprint rockImprintRef={scene.rockImprintRef} />
      <Rock rockRef={scene.rockRef} />
      <div ref={scene.remoteCursorLayerRef} className="remote-cursors" aria-hidden="true" />
      <div ref={scene.handCursorRef} className="hand-cursor" aria-hidden="true" />
    </main>
  );
}
