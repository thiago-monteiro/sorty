import { useState } from "react";
import type { Room } from "../domain/types";
type Props = {
  room: Room;
  selectedId?: string;
  onSave: (room: Room) => void;
  onClose: () => void;
};
export default function RoomEditor({
  room,
  selectedId,
  onSave,
  onClose,
}: Props) {
  const [draft, setDraft] = useState<Room>(() => structuredClone(room));
  const [error, setError] = useState("");
  const xs = draft.boundary.map((p) => p.x),
    ys = draft.boundary.map((p) => p.y);
  const width = Math.max(...xs) - Math.min(...xs),
    depth = Math.max(...ys) - Math.min(...ys);
  const changeSize = (axis: "x" | "y", value: number) => {
    if (!Number.isFinite(value) || value <= 0 || value > 30) return;
    const min = Math.min(...draft.boundary.map((p) => p[axis]));
    const old = axis === "x" ? width : depth;
    setDraft({
      ...draft,
      source: "manual",
      reviewed: false,
      boundary: draft.boundary.map((p) => ({
        ...p,
        [axis]: min + ((p[axis] - min) * value) / old,
      })),
    });
  };
  const numeric = (
    label: string,
    value: number,
    onChange: (v: number) => void,
    min = -100,
  ) => (
    <label>
      {label}
      <input
        type="number"
        min={min}
        step="any"
        required
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section
        className="modal editor-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="editor-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header>
          <div>
            <span className="eyebrow">YOUR ROOM, IN METERS</span>
            <h2 id="editor-title">Make it your space.</h2>
          </div>
          <button
            className="icon-button"
            aria-label="Close room editor"
            onClick={onClose}
          >
            ×
          </button>
        </header>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const finite = (n: number) => Number.isFinite(n);
            if (
              draft.boundary.some(
                (p) => Math.abs(p.x) > 100 || Math.abs(p.y) > 100,
              ) ||
              [draft.start, draft.goal].some(
                (p) =>
                  !Number.isFinite(p.x) ||
                  !Number.isFinite(p.y) ||
                  Math.abs(p.x) > 100 ||
                  Math.abs(p.y) > 100,
              ) ||
              !draft.name.trim() ||
              draft.obstacles.some(
                (o) =>
                  ![o.x, o.y, o.width, o.depth].every(finite) ||
                  o.width <= 0 ||
                  o.width > 30 ||
                  o.depth <= 0 ||
                  o.depth > 30 ||
                  Math.abs(o.x) > 100 ||
                  Math.abs(o.y) > 100,
              )
            ) {
              setError("Add a name and valid positive object dimensions.");
              return;
            }
            onSave({
              ...draft,
              source: "manual",
              capturedAt: new Date().toISOString(),
              reviewed: true,
            });
          }}
        >
          <label>
            Room name
            <input
              value={draft.name}
              required
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </label>
          <div className="field-row">
            {numeric("Room width", width, (v) => changeSize("x", v), 1)}
            {numeric("Room depth", depth, (v) => changeSize("y", v), 1)}
          </div>
          <p className="field-note">
            Dimension changes resize the boundary. Check object positions and
            endpoints before saving. Numeric edits are labeled manual
            measurements.
          </p>
          <div className="editor-objects">
            {draft.obstacles.map((o) => (
              <fieldset
                key={o.id}
                className={selectedId === o.id ? "selected-field" : ""}
              >
                <legend>{o.label}</legend>
                <div className="field-row">
                  <label>
                    Object label
                    <input
                      value={o.label}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          obstacles: draft.obstacles.map((v) =>
                            v.id === o.id
                              ? {
                                  ...v,
                                  label: e.target.value,
                                  source: "manual",
                                }
                              : v,
                          ),
                        })
                      }
                    />
                  </label>
                  <button
                    type="button"
                    className="text-button danger"
                    onClick={() =>
                      setDraft({
                        ...draft,
                        obstacles: draft.obstacles.filter((v) => v.id !== o.id),
                      })
                    }
                  >
                    Remove
                  </button>
                </div>
                <div className="field-row four">
                  {(["x", "y", "width", "depth"] as const).map((key) =>
                    numeric(
                      key,
                      o[key],
                      (v) =>
                        setDraft({
                          ...draft,
                          obstacles: draft.obstacles.map((a) =>
                            a.id === o.id
                              ? { ...a, [key]: v, source: "manual" }
                              : a,
                          ),
                        }),
                      key === "width" || key === "depth" ? 0.05 : -100,
                    ),
                  )}
                </div>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={o.movable}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        obstacles: draft.obstacles.map((a) =>
                          a.id === o.id
                            ? { ...a, movable: e.target.checked }
                            : a,
                        ),
                      })
                    }
                  />{" "}
                  I can safely move this object
                </label>
              </fieldset>
            ))}
          </div>
          <button
            type="button"
            className="secondary"
            disabled={draft.obstacles.length >= 30}
            onClick={() =>
              setDraft({
                ...draft,
                obstacles: [
                  ...draft.obstacles,
                  {
                    id: crypto.randomUUID(),
                    label: "New object",
                    x: 0.2,
                    y: 0.2,
                    width: 0.5,
                    depth: 0.5,
                    movable: true,
                    kind: "clutter",
                    source: "manual",
                  },
                ],
              })
            }
          >
            + Add an object
          </button>
          <h3>Doorway</h3>
          <label>
            Measured clear opening (meters)
            <input
              type="number"
              min="0.05"
              max="30"
              step="0.01"
              value={draft.doorwayWidth ?? ""}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  doorwayWidth: e.target.value
                    ? Number(e.target.value)
                    : undefined,
                })
              }
            />
          </label>
          <p className="field-note">
            Measure the clear opening. Leave blank if it has not been measured.
          </p>
          <h3>Route endpoints</h3>
          <div className="field-row four">
            {(["start", "goal"] as const).flatMap((key) =>
              (["x", "y"] as const).map((axis) =>
                numeric(`${key} ${axis}`, draft[key][axis], (v) =>
                  setDraft({ ...draft, [key]: { ...draft[key], [axis]: v } }),
                ),
              ),
            )}
          </div>
          <label className="checkbox">
            <input type="checkbox" required /> I have reviewed the room
            boundary, positions, and captured areas.
          </label>
          {error && <p role="alert">{error}</p>}
          <footer>
            <button type="button" className="secondary" onClick={onClose}>
              Cancel
            </button>
            <button className="primary" type="submit">
              Save room <span>↗</span>
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
