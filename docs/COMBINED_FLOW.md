# Combined metric and visual agent

The default Android flow keeps one WebXR reference frame for scanning, object labels, measured route planning and guidance. Browser speech recognition accepts the goal and commands, with local Whisper when the browser has no recognizer. A single local Qwen VLM supplies object names, descriptions, cautious movability estimates and task intent.

1. Start the metric scan and say or type a goal.
2. Sweep visible floor and objects. Finish with the button or a voice command.
3. Capture a real, pose-synchronized camera image with optional WebXR `camera-access`.
4. The VLM returns task or route intent, image boxes and object semantics.
5. Associate image detections with projected measured footprints. This association never turns image-box pixels into metric dimensions. An unmatched box still gets an AR pointing anchor by unprojecting its bottom center onto the captured floor plane.
6. Route goals use the measured-geometry planner, with a start near the tracked camera and an arrival point outside a grounded target. General tasks keep the VLM's ordered steps; the app anchors the active step and advances locally on Done.
7. Spatial arrows and labels use the same XR frame. Voice reports progress or requests a fresh view; tracking resets invalidate pending results and anchors. Only Check result sends a new frame to the VLM.

There is no tap-to-select-movable-objects step. Only unambiguously associated, model-likely-portable objects below the measured footprint bounds become relocation candidates. Unknown and unmatched items remain fixed. These gates are conservative heuristics, not proof of handling safety.

Grounding uses projected measured footprints and a coarse vertical envelope for matching only. It rejects tiny-part-to-whole-object matches, invalid camera transforms and ambiguous associations. It can still misassociate objects; actual Android calibration and movement tests remain necessary. Floor sensing is partial, axis-aligned footprints are conservative, and hidden obstacles are not established by the scan.

Raw camera access is required to combine scene understanding with the active metric frame. If the browser cannot provide it, the app offers the ordinary camera assistant; that fallback does not claim metric world anchors. An AR render canvas is never submitted as a pretend camera photo.

Runtime: vision on loopback 1235, optional local Whisper fallback on 1236, app on 5173, public HTTPS through the existing phone tunnel. See LOCAL_SCENE_VLM.md and LOCAL_SPEECH.md for model setup.
