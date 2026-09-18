/**
 * Push / pull movement helpers.
 *
 * A push moves a token away from a reference point along the ray that connects
 * them; a negative distance pulls it toward the point instead. Movement is
 * collision aware and always lands on the grid.
 */

const MAX_ATTEMPTS = 100;
const BACK_OFF_SQUARES = 5;
/** Foundry's snapping mode for the top-left corner of a token footprint. */
const CORNER_SNAP_MODE = 0xFF0;

/**
 * Build the ray a token travels along: it starts at the token centre and keeps
 * the heading from `origin` to the token.
 */
function travelRay(target, origin) {
  const heading = new foundry.canvas.geometry.Ray(origin, target.center);
  return foundry.canvas.geometry.Ray.fromAngle(
    target.center.x,
    target.center.y,
    heading.angle,
    heading.distance
  );
}

function blocked(target, point, ray, checkCollision) {
  if (!checkCollision) return false;
  return target.checkCollision(point, { origin: ray.A, type: "move", mode: "any" });
}

/**
 * Calculate the token update for a single push / pull.
 *
 * @param {Token} target        Token placeable to move.
 * @param {{x:number,y:number}} originPoint  Reference point in canvas pixels.
 * @param {number} distance     Grid squares to move; negative pulls inward.
 * @param {{checkCollision?: boolean}} [options]
 * @returns {{_id: string, x: number, y: number}|undefined}
 */
export function calculatePushUpdate(target, originPoint, distance, { checkCollision = true } = {}) {
  if (!target?.center || !originPoint || !distance) return undefined;

  const ray = travelRay(target, originPoint);
  if (!ray.distance) return undefined;

  let travel = distance;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const squares = travel / canvas.dimensions.distance;
    const landing = ray.project((canvas.dimensions.size * squares) / ray.distance);

    if (!blocked(target, landing, ray, checkCollision)) {
      const corner = canvas.grid.getSnappedPoint(
        { x: landing.x - target.w / 2, y: landing.y - target.h / 2 },
        { mode: CORNER_SNAP_MODE }
      );
      return { _id: target.id, x: corner.x, y: corner.y };
    }

    const previous = travel;
    travel += travel > 0 ? -BACK_OFF_SQUARES : BACK_OFF_SQUARES;
    if (travel === 0 || Math.sign(previous) !== Math.sign(travel)) return undefined;
  }

  return undefined;
}

/**
 * Calculate token updates for several targets. Tokens that cannot be moved are
 * left out of the result.
 */
export function calculatePushUpdates(targets, originPoint, distance, options = {}) {
  const updates = [];
  for (const target of targets) {
    const update = calculatePushUpdate(target, originPoint, distance, options);
    if (update) updates.push(update);
  }
  return updates;
}
