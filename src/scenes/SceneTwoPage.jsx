import { useEffect, useLayoutEffect, useRef } from "react";
import { ScenePage } from "../components/ScenePage";
import { SETTINGS_SCENES } from "../config/settings.mjs";

const STICKY_ROCK_SETTINGS = Object.freeze({
  randomDropEnabled: false,
  rockJumpEnabled: false,
  sceneTwoBarrierEnabled: false,
  stationaryAutoSlipEnabled: false,
});

function useSceneTwoRuntimeGuards(stickyRef) {
  useLayoutEffect(() => {
    const nativeFetch = window.fetch;

    function keepWindowDragActive(event) {
      if (!stickyRef.current) {
        return;
      }
      event.stopImmediatePropagation();
    }

    function sceneTwoFetch(input, init) {
      let nextInit = init;

      if (typeof init?.body === "string") {
        try {
          const payload = JSON.parse(init.body);
          if (payload?.sceneId === SETTINGS_SCENES.TURNIP) {
            nextInit = {
              ...init,
              body: JSON.stringify({
                ...payload,
                roomSettings: {
                  ...payload.roomSettings,
                  ...STICKY_ROCK_SETTINGS,
                },
              }),
            };
          }
        } catch {
          // Не-JSON запросы проходят без изменений.
        }
      }

      return nativeFetch.call(this, input, nextInit);
    }

    window.addEventListener("pointerup", keepWindowDragActive);
    window.addEventListener("pointercancel", keepWindowDragActive);
    window.addEventListener("blur", keepWindowDragActive);
    window.fetch = sceneTwoFetch;

    return () => {
      window.removeEventListener("pointerup", keepWindowDragActive);
      window.removeEventListener("pointercancel", keepWindowDragActive);
      window.removeEventListener("blur", keepWindowDragActive);
      if (window.fetch === sceneTwoFetch) {
        window.fetch = nativeFetch;
      }
    };
  }, [stickyRef]);
}

function forwardedPointerMove(event) {
  return new PointerEvent("pointermove", {
    bubbles: true,
    button: event.button,
    buttons: event.buttons,
    cancelable: true,
    clientX: event.clientX,
    clientY: event.clientY,
    composed: true,
    ctrlKey: event.ctrlKey,
    isPrimary: event.isPrimary,
    metaKey: event.metaKey,
    pointerId: event.pointerId,
    pointerType: event.pointerType,
    pressure: event.pressure,
    screenX: event.screenX,
    screenY: event.screenY,
    shiftKey: event.shiftKey,
  });
}

function useStickySceneTwoRock(stickyRef) {
  useEffect(() => {
    const scenePage = document.querySelector(
      `[data-scene-page="${SETTINGS_SCENES.TURNIP}"]`,
    );
    const world = scenePage?.querySelector(":scope > .world");
    const rock = world?.querySelector(":scope > .rock");
    const runtimeSettings =
      window.__sisyphusTestApi?.sceneId === SETTINGS_SCENES.TURNIP
        ? window.__sisyphusTestApi.params
        : null;
    const restartButton = scenePage?.querySelector(
      '[data-testid="restart-session"]',
    );

    if (!rock || !world) {
      return undefined;
    }

    if (runtimeSettings) {
      Object.assign(runtimeSettings, STICKY_ROCK_SETTINGS);
    }

    let forwardingMove = false;

    function blockRepeatedRockPointerDown(event) {
      if (stickyRef.current) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }

    function latchRockToHand(event) {
      if (
        stickyRef.current ||
        event.isPrimary === false ||
        (event.pointerType === "mouse" && event.button !== 0)
      ) {
        return;
      }

      if (rock.classList.contains("is-dragging")) {
        stickyRef.current = true;
        rock.dataset.stickyToHand = "true";
      }
    }

    function keepRockAttached(event) {
      if (!stickyRef.current) {
        return;
      }

      if (event.cancelable) {
        event.preventDefault();
      }
      event.stopImmediatePropagation();
    }

    function forwardMoveToRock(event) {
      const targetIsRock =
        event.target instanceof Node &&
        (event.target === rock || rock.contains(event.target));
      if (!stickyRef.current || forwardingMove || targetIsRock) {
        return;
      }

      forwardingMove = true;
      try {
        rock.dispatchEvent(forwardedPointerMove(event));
      } finally {
        forwardingMove = false;
      }
    }

    function resetStickyRock() {
      stickyRef.current = false;
      delete rock.dataset.stickyToHand;
    }

    rock.addEventListener("pointerdown", blockRepeatedRockPointerDown, true);
    rock.addEventListener("pointerdown", latchRockToHand);
    rock.addEventListener("pointerup", keepRockAttached, true);
    rock.addEventListener("pointercancel", keepRockAttached, true);
    rock.addEventListener("lostpointercapture", keepRockAttached, true);
    window.addEventListener("pointermove", forwardMoveToRock, true);
    restartButton?.addEventListener("click", resetStickyRock, true);

    return () => {
      resetStickyRock();
      rock.removeEventListener("pointerdown", blockRepeatedRockPointerDown, true);
      rock.removeEventListener("pointerdown", latchRockToHand);
      rock.removeEventListener("pointerup", keepRockAttached, true);
      rock.removeEventListener("pointercancel", keepRockAttached, true);
      rock.removeEventListener("lostpointercapture", keepRockAttached, true);
      window.removeEventListener("pointermove", forwardMoveToRock, true);
      restartButton?.removeEventListener("click", resetStickyRock, true);
    };
  }, [stickyRef]);
}

export function SceneTwoPage() {
  const stickyRef = useRef(false);
  useSceneTwoRuntimeGuards(stickyRef);
  useStickySceneTwoRock(stickyRef);

  return (
    <ScenePage
      sceneId={SETTINGS_SCENES.TURNIP}
      sceneLabel="Сцена 2. Репка"
      nextSceneHref="/scene-3"
    />
  );
}
