import birch01Url from "../../assets/background/birches/birch_01.png";
import birch02Url from "../../assets/background/birches/birch_02.png";
import birch03Url from "../../assets/background/birches/birch_03.png";
import birch04Url from "../../assets/background/birches/birch_04.png";
import birch05Url from "../../assets/background/birches/birch_05.png";
import birch06Url from "../../assets/background/birches/birch_06.png";
import birch07Url from "../../assets/background/birches/birch_07.png";
import birch08Url from "../../assets/background/birches/birch_08.png";
import birch09Url from "../../assets/background/birches/birch_09.png";

const BIRCHES = Object.freeze([
  { depth: "behind", url: birch01Url },
  { depth: "front", url: birch02Url },
  { depth: "behind", url: birch03Url },
  { depth: "front", url: birch04Url },
  { depth: "front", url: birch05Url },
  { depth: "front", url: birch06Url },
  { depth: "behind", url: birch07Url },
  { depth: "front", url: birch08Url },
  { depth: "behind", url: birch09Url },
]);

export function BirchLayer({ depth }) {
  return (
    <div className={`birch-layer birch-layer--${depth}`} aria-hidden="true">
      {BIRCHES.map((birch, index) =>
        birch.depth === depth ? (
          <img
            key={birch.url}
            className="birch-layer__tree"
            data-birch-index={index + 1}
            src={birch.url}
            alt=""
            draggable="false"
            style={{ "--birch-x": `${((index + 0.5) / BIRCHES.length) * 100}%` }}
          />
        ) : null,
      )}
    </div>
  );
}
