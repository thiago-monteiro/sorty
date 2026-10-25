export type SceneObject = {
  id: string;
  label: string;
  description?: string;
  box: [number, number, number, number];
  score?: number;
  movable?: "likely" | "unlikely" | "unknown";
};
export type SceneStep = { id: string; instruction: string; targetId?: string };
export type ScenePlan = {
  status?: "working" | "complete" | "needs_input";
  /** Route = reach/access/space goal; task = every other general goal. */
  intent?: "route" | "task";
  /** Object id from this same plan; only for route goals with one visible destination. */
  navigationTargetId?: string;
  summary: string;
  objects: SceneObject[];
  steps: SceneStep[];
  question?: string;
  model: string;
  verified: false;
};

/** Account for object-fit: cover without pretending image coordinates are metric AR. */
export function coverBox(
  box: SceneObject["box"],
  image: { width: number; height: number },
  viewport: { width: number; height: number },
  fit: "cover" | "contain" = "cover",
) {
  const scale = (fit === "contain" ? Math.min : Math.max)(
    viewport.width / image.width,
    viewport.height / image.height,
  );
  const width = image.width * scale;
  const height = image.height * scale;
  return {
    x: box[0] * width + (viewport.width - width) / 2,
    y: box[1] * height + (viewport.height - height) / 2,
    width: box[2] * width,
    height: box[3] * height,
  };
}
