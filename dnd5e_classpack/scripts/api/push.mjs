/**
 * Push/pull movement helpers.
 */

import { log, resolveOriginPoint } from "./utils.mjs";


/**
 * Calculate a single token update for a push/pull movement.
 * `distance` is in grid units; positive pushes away from the origin, negative
 * pulls toward it. Uses the same collision-aware ray logic as CPR.
 */
export function calculatePushUpdate(target, originPoint, distance, { checkCollision = true } = {}) {
  if (!target?.center || !originPoint || !distance) return undefined;

  const ray = new foundry.canvas.geometry.Ray(originPoint, target.center);
  const movementRay = foundry.canvas.geometry.Ray.fromAngle(
    target.center.x,
    target.center.y,
    ray.angle,
    ray.distance
  );

  if (!movementRay.distance) return undefined;

  let remaining = distance;
  for (let guard = 0; guard < 100; guard++) {
    const gridUnits = remaining / canvas.dimensions.distance;
    const point = movementRay.project(canvas.dimensions.size * gridUnits / movementRay.distance);

    const collision = checkCollision ? target.checkCollision(point, {
      origin: movementRay.A,
      type: "move",
      mode: "any"
    }) : false;

    if (collision) {
      const previous = remaining;
      remaining += remaining > 0 ? -5 : 5;
      if (remaining === 0 || Math.sign(previous) !== Math.sign(remaining)) return undefined;
    } else {
      const snapped = canvas.grid.getSnappedPoint(
        { x: point.x - target.w / 2, y: point.y - target.h / 2 },
        { mode: 4080 }
      );
      return { _id: target.id, x: snapped.x, y: snapped.y };
    }
  }

  return undefined;
}

/**
 * Calculate token updates for several targets. Targets that cannot be moved are
 * skipped.
 */
export function calculatePushUpdates(targets, originPoint, distance, options = {}) {
  const updates = [];
  for (const target of targets) {
    const update = calculatePushUpdate(target, originPoint, distance, options);
    if (update) updates.push(update);
  }
  return updates;
}
