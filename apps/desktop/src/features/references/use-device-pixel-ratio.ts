import { useEffect, useState } from "react";

function currentRatio() {
  const ratio = window.devicePixelRatio;
  return Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
}
export function useDevicePixelRatio() {
  const [ratio, setRatio] = useState(currentRatio);
  useEffect(() => {
    let query: MediaQueryList;
    const update = () => {
      query?.removeEventListener("change", update);
      const value = currentRatio();
      setRatio(value);
      query = window.matchMedia(`(resolution: ${value}dppx)`);
      query.addEventListener("change", update);
    };
    update();
    window.addEventListener("resize", update);
    return () => {
      query.removeEventListener("change", update);
      window.removeEventListener("resize", update);
    };
  }, []);
  return ratio;
}
