import rockImage from "../../assets/rock/rock-03.png";

export function Rock({ rockRef }) {
  return (
    <img
      ref={rockRef}
      className="rock"
      src={rockImage}
      alt="Камень"
      draggable="false"
    />
  );
}
