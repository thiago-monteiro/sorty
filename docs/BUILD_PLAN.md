# Sorty — measure a room, make a task possible

> Current implementation: camera-first automatic surface capture supersedes the manual origin/corner tracing below. The live flow keeps scanning, point labels, arrows, and voice guidance in one WebXR session. See [automatic scan behavior](AUTO_SCAN.md) and [current demo instructions](../README.md). The original planning brief is retained below as design history.

## Product decision

Build an Android Chrome web app that measures a room with WebXR, finds spatial barriers to a specific activity, plans a small set of changes, and guides someone through those changes with AR and voice. Re-measure afterward to check the result.

The opening question is **“What do you want to be able to do in this room?”** The first supported goal is **“Make a clear route from this doorway to this seat, with space to turn.”** The operator is a resident, friend, caregiver, or volunteer preparing the space.

Pitch: **Sorty closes the loop between seeing a barrier and fixing it: measure → reason → preview → guide → verify.**

User-selected platform: Android phone, Chrome, web only. No native app, ARKit, iOS support, or headset requirement in the hackathon scope.

## The live demo

Use a real room with a chair and a lightweight box or basket obstructing a route. Have a tape measure available to compare a measured segment.

1. Open the app on the phone over HTTPS; grant camera/microphone permissions when needed.
2. Start AR, acquire the floor, and tap the room boundary, route endpoints, and obstacle footprints. Place a reticle at real floor points rather than drawing over a photograph.
3. Set the goal: “Make a route from the door to this seat.” Select the desired clear width and turning-space target.
4. Show the measured top-down map and spatial overlays: the obstruction, the narrow segment, and the requested clearance envelope.
5. Generate a plan with actual object destinations. Preview the proposed footprints and route in AR.
6. Start spoken guidance: “Move the basket to the highlighted area beside the wall.” Prop the phone up to perform the action with both hands free.
7. Say “That spot is taken.” Mark the new obstacle or forbidden destination; the planner changes the destination and explains why. Do not infer the obstacle's metric position from the words alone.
8. Say “Done” and then “Check.” A fresh image supports an object-state check; metric clearance remains pending until re-measured.
9. Re-enter measurement mode, re-localize if necessary, and re-measure changed obstacle footprints and the bottleneck. Show before/after measured values and completed versus unresolved checks.

The surprise is that a newly unavailable destination causes a geometrically valid alternative plan, and the final result is checked against new observations.

## What the first version actually assesses

- A route through one approximately level room, using measured 2D floor geometry.
- Obstacles represented as floor footprints; doors represented by measured clear openings and optional marked swing exclusions.
- A configurable route-clearance target, plus a circular turning-space target near the destination.
- Obstacles that the user explicitly marks movable, fixed, or requiring help.
- A sequence of relocations that keeps objects in the measured room and out of reserved areas.

Seed reference values from the US Access Board's ADA guidance: 36 inches / 914.4 mm for the general route-width check; 32 inches / 812.8 mm for a separately identified doorway clear-opening check; 60 inches / 1524 mm for a circular turning-space check. These are limited, contextual reference checks, not a complete accessibility assessment. Door maneuvering clearances, slopes, thresholds, surface conditions, T-turn alternatives, and a person's actual mobility requirements need additional assessment. Use exact inch conversions internally; label customary rounded metric references where displayed.

The result must say **“Selected spatial checks met,” “Needs adjustment,” or “Uncertain / not assessed.”** Do not issue an overall accessibility score or an “ADA compliant” certificate.

Sources: [accessible routes and doors](https://www.access-board.gov/ada/chapter/ch04/), [clear floor and turning space](https://www.access-board.gov/ada/guides/chapter-3-clear-floor-or-ground-space-and-turning-space/).

## Measurement and AR design

### Guided metric capture

- Feature-detect `navigator.xr`, `isSessionSupported('immersive-ar')`, and the requested session features. Show a useful unsupported-device result if unavailable.
- Use WebXR hit testing on a compatible Android/ARCore device and serve over HTTPS. A phone visiting a laptop's plain HTTP LAN address does not satisfy the secure-context requirement.
- Establish a floor-aligned local frame. Flatten points onto the floor plane before calculating horizontal route widths; a slanted 3D point-to-point distance is not a clear floor width.
- Tap 3+ boundary points; capture rectangular obstacle footprints with an orientation and dimensions. Allow measured numeric corrections and object labels.
- Let the user name the door, destination, chair, basket, and forbidden areas. Vision can propose labels; user confirmation connects a name to a measured footprint.
- Record each measurement's source, timestamp, tracking status, and user confirmation. Use a configurable conservative tolerance as an engineering margin, not a claimed statistical confidence interval.
- If the estimated clearance is close to the target relative to that margin, show “re-measure” rather than a pass. Verify the key demo bottleneck with a tape measure.
- Tracking loss, a reference-space reset, or substantial drift pauses spatial instructions. Require re-localization or a re-scan before trusting overlays.

WebXR exposes metric spatial poses and hit tests. It does not promise survey accuracy, a complete room mesh, recognition of every obstacle, or persistent anchors across sessions. The first build deliberately uses guided capture rather than automatic reconstruction.

Sources: [WebXR Device API](https://www.w3.org/TR/webxr/), [hit-test module](https://www.w3.org/TR/webxr-hit-test-1/), [WebXR on ARCore](https://developers.google.com/ar/develop/webxr).

### Separate measurement and camera-guidance modes

Do not assume immersive AR gives the vision model camera pixels. Raw camera access is a separate optional capability, and simultaneous `getUserMedia` plus immersive AR must be tested on the actual phone.

The required implementation uses two modes sharing the same task state:

1. **Measure / preview:** immersive WebXR, hit-test reticle, metric footprints, proposed ghost placements, path overlays.
2. **Guide / inspect:** ordinary camera video preview, speech input/output, and deliberate captured frames for vision checks. The phone can be propped up. Video is not continually sent to a model.

On returning to AR, validate the coordinate frame. If it changed, use two recognizable floor reference points to restore origin and heading on a confirmed floor, or re-scan. Never silently render old coordinates in a new frame. If restoration is unreliable, require a new measurement.

If raw-camera access and simultaneous voice are verified on the chosen phone, unify the modes as a stretch goal. The core demo must already work with the explicit transition.

Source: [WebXR raw camera access](https://immersive-web.github.io/raw-camera-access/).

## Technical architecture

**Android client:** TypeScript + React; Three.js for AR and a top-down room view; browser camera and audio; Web Worker for search; session persistence in IndexedDB. Keep measured coordinates in meters throughout.

**Laptop service:** Node/Express for bounded vision requests, optional transcription fallback, and explicit capability/health status. Phone accesses the app and API through a single HTTPS origin. Vision-provider choice stays behind an adapter: try a small local model on this laptop, measure latency, and keep manual labeling fully functional. Do not make room geometry dependent on model performance.

**AI's responsibility:** propose object labels, interpret constrained spoken goals, phrase instructions, and compare selected before/after frames. It never supplies unmeasured dimensions, declares a corridor clear from an image alone, or directly mutates confirmed geometry.

**Geometry engine's responsibility:** obstacle intersection, clearance, connectivity, turning-space checks, valid destinations, and plan validation. These functions run independently of an LLM.

**Supervisor's responsibility:** enforce search/inference time limits, identify stale geometry, stop on tracking loss, preserve reported versus verified completion, and ask for a new observation after repeated failures.

Suggested modules:

- `src/domain/`: room, measurement, profile, plan, session types.
- `src/geometry/`: floor projection, polygon operations, occupancy, collision and clearance checks.
- `src/planner/`: candidate destinations, bounded relocation search, plan validation.
- `src/xr/`: session lifecycle, hit tests, floor frame, rendering, re-localization.
- `src/guidance/`: command parsing, speech lifecycle, task state machine.
- `src/vision/`: typed client adapter and reviewable observations.
- `server/`: model adapter, request validation, timeouts, health endpoint.

## Planning algorithm

1. Build a conservative 2D occupancy grid from the captured room boundary and obstacle footprints. Treat uncaptured/unreviewed areas as unknown, not available free space.
2. Inflate obstacles and shrink the room boundary using half the chosen clearance width plus the measurement margin. A grid path for the resulting center point is a conservative planar clearance test. This approximation is not a full wheelchair kinematics model.
3. Search for a route between the selected endpoints and a collision-free turning circle at the destination. Check doorway clearance separately; do not silently apply doorway exceptions to general corridors.
4. If blocked, generate a small finite set of destination footprints along usable walls or in user-approved storage zones. Retain existing orientation for the first build.
5. Explore bounded relocation states, starting with one moved object and then two. Reject overlaps, blocked doors, out-of-bound placements, fixed/heavy objects, and moves whose staging/destination access is not feasible in the model.
6. Rank feasible solutions lexicographically: satisfy required spatial checks; move fewer objects; reduce estimated effort and travel. Check each intermediate state and preserve designated exit areas. If safe manipulation cannot be established, flag the move for user/helper review rather than silently approving it.
7. Stop at a fixed state/time budget. Independently revalidate the returned plan. Say “best plan found” unless the complete finite search establishes optimality for the stated model.

Bound the first scene to one room, roughly eight obstacle footprints, and at most two proposed relocations. An honestly reported unsolved case is preferable to a geometrically invalid suggestion.

## Voice and video execution loop

Task state: `planned → offered → in_progress → reported_done → verification_pending → verified`, with `blocked`, `paused`, and `needs_help` branches.

- **“Next / done”** records reported completion and advances appropriately; does not manufacture verification.
- **“Repeat / go back”** repeats narration or reviews a previous step. Going back does not imply a physical move was undone.
- **“That spot is taken / I can't move that”** marks the plan blocked and requests a spatial update or changes movability; then replans.
- **“Check”** captures a new frame in camera mode. A model result is a reviewable observation, not ground truth.
- **“Pause / stop / I need help”** stops narration and progression immediately.
- **“Re-measure”** begins the AR verification phase.

Start with a small deterministic command grammar, including synonyms, before adding open-ended interpretation. Prevent the app's own speech from triggering commands. Pause recognition during speech output, restart carefully, handle permission failures, and provide large equivalent controls. Browser speech recognition may use a network service; do not claim offline operation. If unsupported/unreliable, provide push-to-talk with a transcription adapter or tap controls and visibly report the limitation.

Source: [SpeechRecognition](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition).

## Build sequence and gates

### 1. Prove device feasibility first

Deliver an HTTPS-served Android page that enters immersive AR, places two floor points, shows their horizontal metric distance, and checks camera/microphone availability. Compare a known distance to a tape measure. Test switching AR ↔ camera and determine whether voice works in each mode. This gate comes before visual polish or model installation.

If AR is unsupported on the available Android device, stop the WebXR claim and report the hardware issue. A separately labeled manual-measurement mode can exercise the rest of the system, but it is not a live AR scan.

### 2. Complete the non-AI geometry loop

Capture a simple room, label obstacles manually, select route endpoints, render the map, calculate blocked/clear regions, and generate a valid relocation plan. The same engine runs against a clearly labeled saved scene for repeatable testing and a backup demo.

### 3. Add spatial previews and real execution

Show ghost placements in AR; narrate one task at a time; accept commands; block/replan; persist session state. Test the entire loop on the actual phone, including putting it down and returning to measurement.

### 4. Add vision where it improves the loop

Object-label suggestions and before/after image comparisons, with uncertainty and confirmation. Evaluate the local model against real captured photos and record latency. Manual correction remains available. No canned output presented as live analysis.

### 5. Verify and package the demo

Re-measure the physical change; show selected checks and before/after values. Rehearse the live obstacle-change interruption. Include a short demo script, source-linked reference checks, device/network setup, and known limitations in the README.

Stretch only after the full loop works: raw-camera access inside AR, automatic segmentation, multiple rooms/people, more complex movement planning, custom reach envelopes, or streaming visual assistance.

## Acceptance criteria

- A compatible Android phone measures a real floor segment through WebXR on HTTPS; the user can inspect and correct it.
- Saved scenes and manual measurements are explicitly labeled and never described as live sensing.
- The app detects the staged blocked route, produces non-overlapping in-room placements, and validates the proposed final layout.
- Changing a destination or an object's movability leads to a new valid plan or a clear unsolved result.
- Guidance can progress by voice on the chosen phone; unsupported or failed speech is visible and recoverable.
- “Done” and visual comparison cannot mark metric accessibility verified without new confirmed measurements.
- A tracking reset cannot leave trusted overlays in the wrong reference frame.
- The final screen separates measured, inferred, user-reported, verified, and unassessed information.
- Geometry tests cover widths around the chosen threshold, conservative margins, turning-circle collisions, doorway context, unknown regions, unreachable destinations, impossible plans, and invalid intermediate placements. Voice tests cover self-trigger prevention, pause, blocked/replan, and reported-versus-verified state.

## Definition of done

A person can scan the staged room on Android, choose the route goal, understand the measured obstruction, preview a valid fix, follow spoken instructions, interrupt with a changed constraint, and re-measure the result. The demo proves a physical outcome and makes its sensing limits visible.

See `webxr-feasibility.md` for the supporting API and browser research.
