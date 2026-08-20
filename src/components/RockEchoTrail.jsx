export function RockEchoTrail({ layerRef }) {
  return (
    <div
      ref={layerRef}
      className="rock-echo-trail"
      data-testid="rock-echo-trail"
      aria-hidden="true"
    />
  );
}
