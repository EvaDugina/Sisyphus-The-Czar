import { rockImageUrl } from "../config/rockImages.mjs";

export function RockImprint({ rockImprintRef }) {
  return (
    <img
      ref={rockImprintRef}
      className="rock-imprint"
      src={rockImageUrl()}
      alt=""
      aria-hidden="true"
      data-testid="rock-imprint"
      draggable="false"
    />
  );
}
