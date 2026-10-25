import { useId } from "react";
import type { Assessment, Plan, Point, Room, Settings } from "../domain/types";

type Props = {
  room: Room;
  assessment: Assessment;
  settings: Settings;
  plan?: Plan | null;
  beforeRoom?: Room;
  proposed: boolean;
  dimensions: boolean;
  compact?: boolean;
  showRoute?: boolean;
  onPoint?: (point: Point) => void;
  onSelect?: (id: string) => void;
};
export default function RoomMap({
  room,
  assessment,
  settings,
  plan,
  beforeRoom,
  proposed,
  showRoute = true,
  onPoint,
  onSelect,
}: Props) {
  const id = useId().replace(/:/g, "");
  const xs = room.boundary.map((p) => p.x),
    ys = room.boundary.map((p) => p.y);
  const minX = Math.min(...xs),
    minY = Math.min(...ys),
    width = Math.max(...xs) - minX,
    height = Math.max(...ys) - minY;
  const scale = Math.max(width, height) / 6,
    pad = 0.6 * scale,
    pin = 0.16 * scale;
  return (
    <svg
      className="room-svg"
      viewBox={`${minX - pad} ${minY - pad} ${width + 2 * pad} ${height + 2 * pad}`}
      role="img"
      aria-label="Your scanned space. Lettered points are objects; numbered points are destinations."
      onClick={(e) => {
        if (!onPoint) return;
        const matrix = e.currentTarget.getScreenCTM();
        if (!matrix) return;
        const point = e.currentTarget.createSVGPoint();
        point.x = e.clientX;
        point.y = e.clientY;
        const local = point.matrixTransform(matrix.inverse());
        onPoint({ x: local.x, y: local.y });
      }}
    >
      <defs>
        <pattern
          id={`grid-${id}`}
          width=".3"
          height=".3"
          patternUnits="userSpaceOnUse"
        >
          <circle cx=".02" cy=".02" r=".009" fill="#597266" />
        </pattern>
        <marker
          id={`arrow-${id}`}
          markerWidth="6"
          markerHeight="6"
          refX="4"
          refY="3"
          orient="auto"
        >
          <path
            d="M1 1 4 3 1 5"
            fill="none"
            stroke="#d2f78e"
            strokeWidth="1.3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </marker>
      </defs>
      <polygon
        points={room.boundary.map((p) => `${p.x},${p.y}`).join(" ")}
        fill="#1a2b23"
        stroke="#8aa18b"
        strokeWidth=".035"
        strokeLinejoin="round"
      />
      <polygon
        points={room.boundary.map((p) => `${p.x},${p.y}`).join(" ")}
        fill={`url(#grid-${id})`}
        opacity=".6"
      />
      {showRoute && assessment.path.length > 1 && (
        <>
          <polyline
            points={assessment.path.map((p) => `${p.x},${p.y}`).join(" ")}
            fill="none"
            stroke="#9acb6b"
            strokeWidth={settings.clearance}
            opacity=".14"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <polyline
            points={assessment.path.map((p) => `${p.x},${p.y}`).join(" ")}
            fill="none"
            stroke="#9acb6b"
            strokeWidth=".035"
            strokeDasharray=".08 .1"
            strokeLinejoin="round"
            markerEnd={`url(#arrow-${id})`}
          />
        </>
      )}
      {room.obstacles.map((o, i) => (
        <g
          key={o.id}
          role={onSelect ? "button" : undefined}
          tabIndex={onSelect ? 0 : undefined}
          aria-label={`Point ${String.fromCharCode(65 + i)}: ${o.label}`}
          onClick={() => onSelect?.(o.id)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onSelect?.(o.id);
            }
          }}
          className="map-object"
        >
          <rect
            x={o.x}
            y={o.y}
            width={o.width}
            height={o.depth}
            rx=".07"
            fill={
              o.kind === "reserved"
                ? "#634735"
                : o.movable
                  ? "#506a3b"
                  : "#35483d"
            }
            stroke={o.movable ? "#c1ef82" : "#617769"}
            strokeWidth=".025"
          />
          <circle
            cx={o.x + o.width / 2}
            cy={o.y + o.depth / 2}
            r={pin}
            fill={o.movable ? "#d2f78e" : "#e3eadd"}
            stroke="#15231b"
            strokeWidth=".025"
          />
          <text
            x={o.x + o.width / 2}
            y={o.y + o.depth / 2}
            fill="#1a2b20"
            fontSize={pin * 1.15}
            fontWeight="600"
            dominantBaseline="central"
            textAnchor="middle"
          >
            {String.fromCharCode(65 + i)}
          </text>
          <title>{o.label}</title>
        </g>
      ))}
      {proposed &&
        plan?.steps.map((step, index) => {
          const object =
            beforeRoom?.obstacles.find((o) => o.id === step.obstacleId) ||
            room.obstacles.find((o) => o.id === step.obstacleId);
          if (!object) return null;
          const ox = object.width / 2,
            oy = object.depth / 2;
          return (
            <g key={step.id} className="move-overlay">
              <rect
                x={step.from.x}
                y={step.from.y}
                width={object.width}
                height={object.depth}
                rx=".07"
                fill="#d2f78e18"
                stroke="#a7c97b"
                strokeWidth=".025"
                strokeDasharray=".05 .05"
              />
              <circle
                cx={step.from.x + ox}
                cy={step.from.y + oy}
                r={pin}
                fill="#d2f78e"
              />
              <text
                x={step.from.x + ox}
                y={step.from.y + oy}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={pin * 1.15}
                fill="#192b20"
              >
                {String.fromCharCode(
                  65 +
                    room.obstacles.findIndex((o) => o.id === step.obstacleId),
                )}
              </text>
              <polyline
                points={(step.movementPath || [step.from, step.to])
                  .map((p) => `${p.x + ox},${p.y + oy}`)
                  .join(" ")}
                fill="none"
                stroke="#d2f78e"
                strokeWidth=".045"
                strokeDasharray=".09 .07"
                strokeLinejoin="round"
                markerEnd={`url(#arrow-${id})`}
              />
              <circle
                cx={step.to.x + ox}
                cy={step.to.y + oy}
                r={pin * 1.3}
                fill="#d2f78e"
              />
              <text
                x={step.to.x + ox}
                y={step.to.y + oy}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={pin * 1.3}
                fontWeight="600"
                fill="#192b20"
              >
                {index + 1}
              </text>
            </g>
          );
        })}
      {[
        { point: room.start, label: "Start" },
        { point: room.goal, label: "Goal" },
      ].map(({ point, label }) => (
        <g key={label}>
          <circle cx={point.x} cy={point.y} r={pin * 0.45} fill="#d2f78e" />
          <text
            x={point.x}
            y={point.y + pin * 1.55}
            fontSize={pin * 0.82}
            textAnchor="middle"
            fill="#bacbb8"
          >
            {label}
          </text>
        </g>
      ))}
    </svg>
  );
}
