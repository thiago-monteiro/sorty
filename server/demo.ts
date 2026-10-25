import { createApp } from "./index";

// A production bundle on the same port as development keeps the Android tunnel URL stable.
const port = Number(process.env.DEMO_PORT || 5173);
createApp().listen(port, "0.0.0.0", () =>
  console.log(
    `Sorty demo ready at http://localhost:${port} — connect your HTTPS tunnel to this port.`,
  ),
);
