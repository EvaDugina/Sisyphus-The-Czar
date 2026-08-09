import rockImage from "../../assets/rock/rock-03.png";

export function RockImprint({ rockImprintRef }) {
  return (
    <img
      ref={rockImprintRef}
      className="rock-imprint"
      src={rockImage}
      alt=""
      aria-hidden="true"
      data-testid="rock-imprint"
      draggable="false"
    />
  );
}
