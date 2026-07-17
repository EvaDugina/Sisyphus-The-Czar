import { Rock } from "./Rock";
import { RockImprint } from "./RockImprint";
import { TrailCanvas } from "./TrailCanvas";
import { WeatherRain } from "./WeatherRain";

export function Scene({ scene, trail, rain }) {
  return (
    <main ref={scene.worldRef} className="world" aria-label="Сцена Царя Дождя">
      <TrailCanvas canvasRef={trail.trailCanvasRef} />
      <section className="summit" aria-hidden="true">
        <div className="target-zone" />
        <h2 className="title2">Миниатюра</h2>
        <h1 className="title">ЦАРЬ ДОЖДЯ</h1>
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
