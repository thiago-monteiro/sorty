import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createSceneRouter, type SceneOptions } from "../server/scene";
import { explicitRouteGoal } from "../server/scene";

const frame = "data:image/png;base64,aGVsbG8=";
test("explicit metric path commands stay distinct from general instruction goals", () => {
  assert.equal(explicitRouteGoal("Find a walking path to the sofa."), true);
  assert.equal(explicitRouteGoal("Clear a path through this room"), true);
  assert.equal(explicitRouteGoal("Help me walk to the chair"), true);
  assert.equal(explicitRouteGoal("Make space on this desk"), false);
  assert.equal(explicitRouteGoal("Set up this laptop"), false);
  assert.equal(
    explicitRouteGoal("Explain the file path shown on screen"),
    false,
  );
});

const validPlan = {
  summary: "A desk holds a mug, loose papers, and a lamp.",
  objects: [
    {
      id: "mug",
      label: "coffee mug",
      description: "White ceramic mug near the left edge of the desk.",
      bbox: [100, 200, 250, 320],
      movable: "likely",
    },
    {
      id: "papers",
      label: "stack of papers",
      description: "Loose papers spread across the middle of the desk.",
      bbox: [400, 300, 600, 400],
      movable: "likely",
    },
    {
      id: "desk",
      label: "desk",
      description: "Wooden desk filling the lower half of the image.",
      bbox: [0, 400, 1000, 950],
      movable: "unlikely",
    },
  ],
  steps: [
    {
      id: "step-1",
      instruction: "Move the mug to the kitchen.",
      targetId: "mug",
    },
    { id: "step-2", instruction: "Stack the loose papers in one pile." },
  ],
  question: "Should the papers be kept?",
};

function vlm(
  output: string,
  onPrompt?: (prompt: string) => void,
  onBody?: (body: Record<string, unknown>) => void,
) {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    assert.match(String(input), /\/chat\/completions$/);
    const body = JSON.parse(String(init?.body)) as {
      model: string;
      messages: { content: { type: string; text?: string }[] }[];
    };
    onBody?.(body);
    assert.equal(body.model, "sorty-scene");
    const parts = body.messages[0].content;
    assert.equal(parts.filter((part) => part.type === "image_url").length, 1);
    onPrompt?.(parts.find((part) => part.type === "text")?.text ?? "");
    return Response.json({ choices: [{ message: { content: output } }] });
  }) as typeof fetch;
}

async function serve(
  options: SceneOptions,
  run: (url: string) => Promise<void>,
) {
  const app = express();
  app.use("/api/scene", createSceneRouter(options));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function post(url: string, body: unknown) {
  return fetch(`${url}/api/scene`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("returns a validated plan with normalized boxes from one VLM", async () => {
  let prompt = "";
  await serve(
    { vlmFetch: vlm(JSON.stringify(validPlan), (value) => (prompt = value)) },
    async (url) => {
      const response = await post(url, {
        image: frame,
        goal: "Organize the desk so I can work.",
      });
      assert.equal(response.status, 200);
      const result = await response.json();
      assert.equal(result.summary, validPlan.summary);
      assert.equal(result.verified, false);
      assert.equal(result.model, "sorty-scene");
      assert.equal(result.intent, "task");
      assert.equal(result.navigationTargetId, undefined);
      assert.deepEqual(result.steps, validPlan.steps);
      assert.equal(result.question, validPlan.question);
      assert.deepEqual(result.objects, [
        {
          id: "mug",
          label: "coffee mug",
          description: "White ceramic mug near the left edge of the desk.",
          box: [0.1, 0.2, 0.15, 0.12],
          movable: "likely",
        },
        {
          id: "papers",
          label: "stack of papers",
          description: "Loose papers spread across the middle of the desk.",
          box: [0.4, 0.3, 0.2, 0.1],
          movable: "likely",
        },
        {
          id: "desk",
          label: "desk",
          description: "Wooden desk filling the lower half of the image.",
          box: [0, 0.4, 1, 0.55],
          movable: "unlikely",
        },
      ]);
      assert.match(prompt, /xyxy_1000/);
      assert.match(prompt, /Organize the desk/);
      assert.match(prompt, /untrusted data/);
    },
  );
});

test("local VLM requests constrain decoding with a JSON grammar", async () => {
  let requestBody: Record<string, unknown> = {};
  await serve(
    {
      vlmFetch: vlm(
        JSON.stringify(validPlan),
        undefined,
        (body) => (requestBody = body),
      ),
    },
    async (url) => {
      const response = await post(url, {
        image: frame,
        goal: "Organize the desk.",
      });
      assert.equal(response.status, 200);
    },
  );
  assert.equal(typeof requestBody.grammar, "string");
  assert.match(String(requestBody.grammar), /q "objects" q/);
  assert.match(String(requestBody.grammar), /bbox-number/);
  assert.equal(requestBody.response_format, undefined);
});

test("old responses without intent or status still default to a working task", async () => {
  const legacy = { summary: "A mug sits on the desk.", objects: [], steps: [] };
  await serve({ vlmFetch: vlm(JSON.stringify(legacy)) }, async (url) => {
    const response = await post(url, {
      image: frame,
      goal: "What is on the desk?",
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.status, "working");
    assert.equal(result.intent, "task");
    assert.equal(result.navigationTargetId, undefined);
  });
});

test("preserves route intent and a navigation target from the same payload", async () => {
  const routePlan = {
    ...validPlan,
    intent: "route",
    navigationTargetId: "desk",
    steps: [
      { id: "step-1", instruction: "Walk toward the desk.", targetId: "desk" },
    ],
  };
  await serve({ vlmFetch: vlm(JSON.stringify(routePlan)) }, async (url) => {
    const response = await post(url, {
      image: frame,
      goal: "Show me how to get to the desk.",
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.intent, "route");
    assert.equal(result.navigationTargetId, "desk");
    assert.deepEqual(result.steps, routePlan.steps);
  });
});

test("rejects a dangling navigation target id", async () => {
  const bad = { ...validPlan, intent: "route", navigationTargetId: "ghost" };
  await serve({ vlmFetch: vlm(JSON.stringify(bad)) }, async (url) => {
    const response = await post(url, {
      image: frame,
      goal: "Walk to the desk.",
    });
    assert.equal(response.status, 502);
    assert.match(
      (await response.json()).error,
      /unknown navigation object id: ghost/,
    );
  });
});

test("rejects an unknown intent", async () => {
  const bad = { ...validPlan, intent: "explore" };
  await serve({ vlmFetch: vlm(JSON.stringify(bad)) }, async (url) => {
    const response = await post(url, { image: frame, goal: "Tidy up." });
    assert.equal(response.status, 502);
    assert.match((await response.json()).error, /invalid plan/);
  });
});

test("accepts fenced JSON and includes the previous plan", async () => {
  let prompt = "";
  await serve(
    {
      vlmFetch: vlm(
        "```json\n" + JSON.stringify(validPlan) + "\n```",
        (value) => (prompt = value),
      ),
    },
    async (url) => {
      const response = await post(url, {
        image: frame,
        goal: "Finish clearing the desk.",
        previous: {
          summary: "Cleared the left side.",
          steps: [{ id: "step-1", instruction: "Move the mug." }],
          currentStep: 1,
        },
      });
      assert.equal(response.status, 200);
      assert.match(prompt, /Cleared the left side/);
      assert.match(prompt, /"currentStep":1/);
    },
  );
});
test("a general explanation or completed task can return no physical action", async () => {
  const answer = {
    status: "complete",
    summary: "The device appears connected.",
    objects: [],
    steps: [],
  };
  await serve({ vlmFetch: vlm(JSON.stringify(answer)) }, async (url) => {
    const response = await post(url, {
      image: frame,
      goal: "Check whether this is connected.",
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.status, "complete");
    assert.deepEqual(result.steps, []);
    assert.equal(result.verified, false);
  });
});

test("allows a question-only answer with no steps", async () => {
  const answer = {
    summary: "The desk is cluttered but usable.",
    objects: [],
    steps: [],
    question: "Do you want the papers kept?",
  };
  await serve({ vlmFetch: vlm(JSON.stringify(answer)) }, async (url) => {
    const response = await post(url, {
      image: frame,
      goal: "What do you see on the desk?",
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.deepEqual(result.steps, []);
    assert.deepEqual(result.objects, []);
    assert.equal(result.question, answer.question);
  });
});

test("rejects an over-long summary", async () => {
  const bad = { ...validPlan, summary: "x".repeat(161) };
  await serve({ vlmFetch: vlm(JSON.stringify(bad)) }, async (url) => {
    const response = await post(url, { image: frame, goal: "Tidy up." });
    assert.equal(response.status, 502);
    assert.match((await response.json()).error, /invalid plan/);
  });
});

test("rejects a dangling target id", async () => {
  const bad = {
    ...validPlan,
    steps: [{ id: "step-1", instruction: "Move it.", targetId: "ghost" }],
  };
  await serve({ vlmFetch: vlm(JSON.stringify(bad)) }, async (url) => {
    const response = await post(url, { image: frame, goal: "Tidy up." });
    assert.equal(response.status, 502);
    assert.match((await response.json()).error, /unknown object id: ghost/);
  });
});

test("rejects out-of-bounds and inverted boxes", async () => {
  const boxes = [
    [0, 0, 1001, 500],
    [0, 0, 0, 500],
    [-1, 0, 100, 500],
    [0, 0, 100, Number.NaN],
  ];
  for (const bbox of boxes) {
    const bad = {
      ...validPlan,
      objects: [{ ...validPlan.objects[0], bbox }],
      steps: [{ id: "step-1", instruction: "Move the mug.", targetId: "mug" }],
    };
    await serve({ vlmFetch: vlm(JSON.stringify(bad)) }, async (url) => {
      const response = await post(url, { image: frame, goal: "Tidy up." });
      assert.equal(response.status, 502, `bbox ${bbox}`);
      assert.match((await response.json()).error, /invalid plan/);
    });
  }
});

test("rejects malformed JSON and missing required fields", async () => {
  for (const output of [
    '{"summary": "A desk", "steps": [oops',
    "no json here",
    '{"summary":"x"}',
  ]) {
    await serve({ vlmFetch: vlm(output) }, async (url) => {
      const response = await post(url, { image: frame, goal: "Tidy up." });
      assert.equal(response.status, 502);
      assert.match((await response.json()).error, /malformed|invalid plan/);
    });
  }
});

test("returns 503 when the local VLM is unavailable", async () => {
  const failing = (async () => {
    throw new Error("ECONNREFUSED");
  }) as typeof fetch;
  await serve({ vlmFetch: failing }, async (url) => {
    const response = await post(url, { image: frame, goal: "Tidy up." });
    assert.equal(response.status, 503);
    assert.match((await response.json()).error, /unavailable/);
  });
});

test("rejects invalid requests", async () => {
  await serve({ vlmFetch: vlm(JSON.stringify(validPlan)) }, async (url) => {
    const invalid = [
      {},
      { image: frame },
      { image: "data:image/gif;base64,aGVsbG8=", goal: "Tidy up." },
      { image: frame, goal: "" },
      { image: frame, goal: "x".repeat(501) },
      { image: frame, goal: "Tidy up.", objects: [] },
      {
        image: frame,
        goal: "Tidy up.",
        previous: { summary: "s", steps: [], currentStep: 1 },
      },
    ];
    for (const body of invalid) {
      assert.equal((await post(url, body)).status, 400);
    }
  });
});
test("an unrecognized named destination asks for a view instead of choosing a random endpoint", async () => {
  const model = { ...validPlan, intent: "task", question: undefined };
  await serve({ vlmFetch: vlm(JSON.stringify(model)) }, async (url) => {
    const response = await post(url, {
      image: frame,
      goal: "Find a walking path to the red door.",
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.intent, "route");
    assert.equal(result.status, "needs_input");
    assert.equal(result.steps.length, 0);
    assert.match(result.question, /destination/);
  });
});

test("allows only one concurrent scene request", async () => {
  let release: (value: string) => void = () => {};
  let calls = 0;
  const slow = (async (input: string | URL | Request, init?: RequestInit) => {
    if (++calls === 1) {
      await new Promise<void>((resolve) => {
        release = () => resolve();
      });
    }
    return Response.json({
      choices: [{ message: { content: JSON.stringify(validPlan) } }],
    });
  }) as typeof fetch;
  await serve({ vlmFetch: slow }, async (url) => {
    const first = post(url, { image: frame, goal: "Organize the desk." });
    await new Promise((resolve) => setTimeout(resolve, 40));
    const second = await post(url, {
      image: frame,
      goal: "Organize the desk.",
    });
    assert.equal(second.status, 429);
    release(JSON.stringify(validPlan));
    assert.equal((await first).status, 200);
    const third = await post(url, {
      image: frame,
      goal: "Organize the desk.",
    });
    assert.equal(third.status, 200);
  });
});

test("times out without returning a partial plan", async () => {
  const stuck = ((_input: string | URL | Request, init?: RequestInit) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener(
        "abort",
        () => reject(new Error("aborted")),
        { once: true },
      );
    })) as typeof fetch;
  await serve({ vlmFetch: stuck, timeoutMs: 40 }, async (url) => {
    const response = await post(url, { image: frame, goal: "Tidy up." });
    assert.equal(response.status, 504);
    assert.match((await response.json()).error, /timed out/);
  });
});
