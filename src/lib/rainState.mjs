export function shouldStartRainExit({
  isActive,
  isHiding,
  isVisible,
}) {
  if (isHiding && !isVisible) {
    return false;
  }
  return isActive || isVisible;
}
