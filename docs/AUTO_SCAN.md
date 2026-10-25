# Automatic observed-area capture

`ScanAccumulator` accepts raw WebXR world coordinates in meters. Room X is world X minus the first supported floor sample's X; room Y is world Z minus that sample's Z. It does not rotate the frame. The snapshot retains raw world points and exposes that origin.

Move the phone slowly across visible floor and objects. Floor height uses the lowest supported height cluster with spatial spread. A tabletop is provisional until a supported lower floor is observed; isolated low outliers do not qualify. Horizontal origin coordinates remain fixed when height is corrected. Tracking resets clear the captured coordinate frame and its plan.

Hits are deduplicated in 10 cm voxels and capped at 10,000 points within 20 m of the XR origin. Floor points are within 8 cm of the supported height. Elevated surfaces between 15 cm and 2 m above it form conservative, generic object footprints; supported horizontal plane evidence can contribute. Overlapping footprint bounds merge. Objects default to fixed until selected by the user. Walls and ceilings are excluded from horizontal-surface evidence.

The counterclockwise convex hull measures **observed area**, using floor hits and supplied horizontal floor polygons. It is not an exact room boundary. It can bridge unknown regions, cover gaps between samples, miss concavities, and miss hidden or unsampled obstacles. Plane polygons also represent detected surface extent, not a complete room. Sensor hits alone cannot prove an area is free or accessible.

Readiness requires a stable floor, at least 3 square meters of hull area, 60 distinct floor observations, 12 occupied half-meter floor cells, at least two seconds between distinct observations, and separated interior candidate points. Start and goal come from observed floor points with 50 cm boundary/object clearance; farthest-point passes choose separated candidates. This clearance is a capture heuristic, not an accessibility assessment. No doorway measurement is required. A sparse or obstructed capture remains unready; `buildRoom()` throws until ready.

Every built room has `source: "webxr"` and `reviewed: false`. A person must confirm the observed boundary, omitted obstacles, and start/goal before planning. There is no completion percentage or claim that the whole room was seen.

Insertion is bounded and voxel deduplicated. Snapshot work is cached until new accepted data arrives; call it at 2 to 4 Hz rather than every XR frame. Do not mutate returned snapshot arrays or points. `clear()` starts a new coordinate/floor capture.


AR planning and guidance remain inside the scan's live XR session. Object letters and target numbers project from metric world positions. Paths carry arrowheads. Off-screen targets receive edge arrows; tracking loss hides spatial labels and pauses progression. Tracking resets invalidate pending planning results before a fresh scan.

