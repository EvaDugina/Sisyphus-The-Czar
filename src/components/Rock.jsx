import { rockImageUrl } from "../config/rockImages.mjs";

export function Rock({ rockRef }) {
  return (
    <img
      ref={rockRef}
      className="rock"
      src={rockImageUrl()}
      alt="Камень"
      draggable="false"
    />
  );
}
