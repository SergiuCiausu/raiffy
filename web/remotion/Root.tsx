import { Composition } from "remotion";
import { StarterClip } from "./StarterClip";
import { VIGNETTES, type StarterVignetteKind } from "@/components/agent/StarterVignettes";
import { DURATION, FPS } from "@/components/agent/starter-motion/timing";

// The starter vignette clips, for preview (`pnpm remotion:studio`) and export (`pnpm remotion:render <kind>`).
export function Root() {
  return (
    <>
      {(Object.keys(VIGNETTES) as StarterVignetteKind[]).map((kind) => (
        <Composition key={kind} id={kind} component={StarterClip} defaultProps={{ kind }}
          durationInFrames={DURATION} fps={FPS} width={360} height={78} />
      ))}
    </>
  );
}
