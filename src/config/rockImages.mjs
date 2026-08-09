import rock03Url from "../../assets/rock/rock-03.png";
import rockUrl from "../../assets/rock/rock.webp";
import rock2Url from "../../assets/rock/rock2.png";

export const DEFAULT_ROCK_IMAGE_ID = "rock-03";

export const ROCK_IMAGE_URLS = Object.freeze({
  "rock-03": rock03Url,
  rock: rockUrl,
  rock2: rock2Url,
});

export function rockImageUrl(imageId) {
  return ROCK_IMAGE_URLS[imageId] || ROCK_IMAGE_URLS[DEFAULT_ROCK_IMAGE_ID];
}
