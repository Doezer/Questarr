import * as React from "react";

const MOBILE_BREAKPOINT = 768;

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined);

  React.useEffect(() => {
    const mql = globalThis.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const legacyMql = mql as MediaQueryList & {
      addListener?: (listener: (event: MediaQueryListEvent) => void) => void;
      removeListener?: (listener: (event: MediaQueryListEvent) => void) => void;
    };
    const addLegacyListener = legacyMql["addListener"];
    const removeLegacyListener = legacyMql["removeListener"];
    const onChange = () => {
      setIsMobile(globalThis.innerWidth < MOBILE_BREAKPOINT);
    };

    if (typeof mql.addEventListener === "function") {
      mql.addEventListener("change", onChange);
    } else if (typeof addLegacyListener === "function") {
      addLegacyListener.call(legacyMql, onChange);
    }

    setIsMobile(globalThis.innerWidth < MOBILE_BREAKPOINT);
    return () => {
      if (typeof mql.removeEventListener === "function") {
        mql.removeEventListener("change", onChange);
      } else if (typeof removeLegacyListener === "function") {
        removeLegacyListener.call(legacyMql, onChange);
      }
    };
  }, []);

  return !!isMobile;
}
