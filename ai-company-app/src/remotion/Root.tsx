import { Composition, type CalculateMetadataFunction } from "remotion";
import { AgentVideo } from "./AgentVideo";
import { CHILD_SAFETY_VERTICAL_CONFIG, ChildSafetyVertical } from "./ChildSafetyVertical";
import {
  defaultAgentVideoSpec,
  getAgentVideoDimensions,
  getAgentVideoDurationSec,
  normalizeAgentVideoSpec,
  type AgentVideoSpec,
} from "./spec";

export interface AgentVideoCompositionProps {
  spec: AgentVideoSpec;
  [key: string]: unknown;
}

const calculateMetadata: CalculateMetadataFunction<AgentVideoCompositionProps> = ({ props }) => {
  const spec = normalizeAgentVideoSpec(props.spec);
  const dimensions = getAgentVideoDimensions(spec.aspectRatio);
  return {
    ...dimensions,
    fps: spec.fps,
    durationInFrames: Math.max(1, Math.round(getAgentVideoDurationSec(spec) * spec.fps)),
    props: { spec },
    defaultOutName: `raviok-agent-video-${Date.now()}`,
    defaultCodec: "h264",
  };
};

export function AgentVideoRoot() {
  const dimensions = getAgentVideoDimensions(defaultAgentVideoSpec.aspectRatio);
  return (
    <>
      <Composition
        id="AgentVideo"
        component={AgentVideo}
        width={dimensions.width}
        height={dimensions.height}
        fps={defaultAgentVideoSpec.fps}
        durationInFrames={Math.round(getAgentVideoDurationSec(defaultAgentVideoSpec) * defaultAgentVideoSpec.fps)}
        defaultProps={{ spec: defaultAgentVideoSpec }}
        calculateMetadata={calculateMetadata}
      />
      <Composition
        id="ChildSafetyVertical"
        component={ChildSafetyVertical}
        {...CHILD_SAFETY_VERTICAL_CONFIG}
      />
    </>
  );
}
