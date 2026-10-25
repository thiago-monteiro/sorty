# WebXR feasibility for Sorty

Researched 2026-10-24 against primary specifications, browser documentation, and U.S. Access Board standards. These are build constraints, not evidence of a tested device implementation.

## Recommended demo contract

Use a real ARCore-capable Android phone with Chrome over HTTPS as the first-class metric AR target. Feature-detect immersive AR and each optional capability. Deliver a camera/photo + manually entered dimensions mode everywhere else. Mark prerecorded room data as a sample. Do not present a calibrated photo overlay as world-tracked AR.

Keep the initial room model bounded: a floor polygon, rectangular obstacle footprints, a doorway, and a user-selected destination. Have the user place or correct geometry. Recognizing furniture from a photo does not determine its metric footprint automatically. Offer automated labeling as assistance, while geometry and accessibility checks stay deterministic.

## Measurements and spatial tracking

- WebXR pose translations are expressed in meters. Hit testing returns poses at intersections with detected real-world geometry, expressed relative to an XR reference space. Two confirmed points in the same space can therefore yield an estimated metric separation. This does not guarantee survey-grade accuracy. [WebXR transforms](https://www.w3.org/TR/webxr/#xrrigidtransform-interface), [hit testing](https://www.w3.org/TR/webxr-hit-test-1/).
- A ray hit is not a full room scan. Hit-test trackables can be points, planes, or meshes depending on support; the module does not guarantee exhaustive mesh reconstruction or semantic object understanding. Require only supported hit testing; treat plane/mesh/depth facilities as enhancements. [Hit-test trackable types](https://www.w3.org/TR/webxr-hit-test-1/#xrhittrackabletype-enum).
- For route clearance, project obstacle footprints and measurements onto a confirmed floor plane. In a level, Y-up space, horizontal point distance is `sqrt(dx*dx + dz*dz)`, while general 3D distance includes `dy*dy`. Two arbitrary screen taps or a diagonal measurement across different heights do not establish usable corridor width. This formula and its usage are engineering deductions from WebXR's metric reference-space definitions. Actual minimum route width requires obstacle boundaries, not merely two point samples.
- Reference spaces can reset after tracking discontinuities. Listen for `reset`, pause affected overlays, transform geometry only when a usable reset transform is available, and otherwise require re-alignment. Small drift can also occur; an AR coordinate is an estimate rather than a permanent room identifier. [Spatial tracking](https://developer.mozilla.org/en-US/docs/Web/API/WebXR_Device_API/Spatial_tracking).
- Anchors and persistent anchors are separate capabilities. The current anchors draft describes persistent handles, but the user agent can delete them. Do not promise cross-session persistence without capability detection and device validation. A fresh session must re-register saved geometry if persistent anchoring is unavailable. [Anchors draft](https://immersive-web.github.io/anchors/).

## Browser and device gate

- Google's WebXR path uses ARCore on compatible Android devices, with Google Play Services for AR installed and enabled. A secure context is required: HTTPS, or device-local localhost development via port forwarding. `http://<laptop-LAN-IP>` alone is not the secure localhost exception. [Google requirements](https://developers.google.com/ar/develop/webxr/requirements), [Google WebXR overview](https://developers.google.com/ar/develop/webxr).
- The live MDN browser-compatibility dataset reports `XRSystem` support in Chrome and no support in Safari, with iOS Safari mirroring Safari. Do not assume an iPhone camera grants WebXR support. Browser/device behavior must be checked at runtime with `navigator.xr` and `isSessionSupported('immersive-ar')`, followed by actual session creation. [MDN compatibility data](https://github.com/mdn/browser-compat-data/blob/main/api/XRSystem.json), [session lifecycle](https://developer.mozilla.org/en-US/docs/Web/API/WebXR_Device_API/Lifecycle).
- Ask for only genuinely required capabilities in `requiredFeatures` so unsupported optional features do not prevent the demo. Requesting a session needs an intentional user action. [Starting WebXR](https://developer.mozilla.org/en-US/docs/Web/API/WebXR_Device_API/Startup_and_shutdown).

## Camera/video and voice are separate gates

- Seeing camera passthrough in AR does not imply JavaScript can read its pixels. Raw camera access is a separate `camera-access` feature, exposes a pose-aligned camera texture, and needs appropriate permission. Request it optionally and verify actual camera availability before using it for vision. [Raw camera specification](https://immersive-web.github.io/raw-camera-access/).
- A normal `getUserMedia` feed is not automatically pose-synchronized with an XR view. Pixel detections from it cannot simply be mapped to the AR world without camera calibration and registration. Concurrent camera ownership is device/browser-dependent; a first-party standards issue discusses implementations requiring exclusive access. The concurrency discussion is an implementation warning, not a universal normative guarantee. [Raw-camera explainer](https://github.com/immersive-web/raw-camera-access/blob/main/explainer.md), [camera concurrency discussion](https://github.com/immersive-web/webxr-ar-module/issues/87).
- Reliable fallback: measure/register the room in AR, release/end the AR camera session, then capture ordinary photos/video for semantic guidance. On returning to AR, re-align if the original coordinate registration cannot be restored. Alternatively use in-session raw camera textures on a verified device. Never silently reuse a previous session's world coordinates in a new reference space.
- DOM overlays can supply interactive captions, microphone status, and large pause/confirm controls in immersive sessions when `dom-overlay` is granted. The specification supplies an overlay mechanism; it does not guarantee microphone or speech-engine support. [DOM overlays](https://www.w3.org/TR/webxr-dom-overlays-1/).
- Web Speech recognition has limited availability and can send audio to a server. Browser speech recognition therefore cannot be advertised as offline/local by default. Feature-detect, disclose the active recognition path, and retain explicit buttons or typed commands. If offline voice is required, implement and test a separate local speech-recognition service. Pause recognition while speaking to reduce feedback. [SpeechRecognition](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition), [using Web Speech](https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API/Using_the_Web_Speech_API).
- Permission denial and hardware conflicts are expected runtime states for camera/microphone acquisition. Release tracks and provide a recoverable flow. [getUserMedia exceptions](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia).

## Accessibility checks that can be demonstrated honestly

For a limited geometric screening mode, show the user's actual mobility-device width and a configurable comfort margin alongside selected standard reference dimensions:

- Accessible walking-surface clear width: 36 in minimum, with a conditional 32 in exception for short constrained segments. Door opening: 32 in minimum measured with a swinging door open 90 degrees, from door face to stop; openings deeper than 24 in need 36 in. Door maneuvering clearances impose additional rules. [ADA Chapter 4, sections 403.5 and 404.2](https://www.access-board.gov/ada/chapter/ch04/).
- Circular turning space: 60 in diameter; a specified T-shaped alternative is also allowed. [ADA Chapter 3, section 304](https://www.access-board.gov/ada/chapter/ch03/).

These few rules cannot certify a room as ADA-compliant or establish its usability for a particular person. Scope and applicability vary; floor surfaces, slopes, thresholds, door force, maneuvering clearances, reach, and other requirements also matter. Product wording should say **geometric clearance check**, list which checks were performed, and distinguish blocked / sufficient measured clearance / needs confirmation / not assessed.

## Uncertainty and acceptance evidence

Recommended engineering policy (not a WebXR accuracy guarantee): store every dimension with its source (`xr-hit-test`, `manual-measurement`, `reference-calibrated-photo`, or `sample`), capture time, registration ID, and user confirmation. Estimate repeatability by sampling a stable target over multiple frames; report this as tracking variation, not a calibrated confidence interval or absolute measurement error. Confirm near-threshold dimensions with a tape measure; show unknown rather than a pass when error could change the outcome.

A known-length reference in one image only gives metric results under stated geometric assumptions, such as coplanar endpoints and a calibrated/projectively rectified plane. A known object elsewhere in a perspective photo does not establish a universal pixels-to-meters conversion. Manual dimensions and a user-edited top-down floor plan are the dependable non-XR baseline.

Before claiming a live demo works, test the specific phone: metric two-point measurement against a tape measure; floor registration; camera acquisition alongside AR or staged camera release; microphone permission and voice commands; TTS feedback suppression; tracking loss and re-entry; and the no-XR fallback. These are acceptance tasks, not completed tests.
