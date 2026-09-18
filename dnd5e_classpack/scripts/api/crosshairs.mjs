/**
 * Interactive crosshair built on Foundry's MeasuredTemplate placeable.
 *
 * A crosshair is a short lived preview template that tracks the pointer until
 * the user left-clicks (confirm) or right-clicks (cancel). Teleport helpers use
 * it to let a player pick a destination on the canvas.
 */

import { sleep } from "./utils.mjs";

const HAZARD_ICON = "icons/svg/hazard.svg";
const TARGET_ICON = "icons/svg/dice-target.svg";

const OUTLINE_ALPHA = 0.75;
const PAN_AFTER_MS = 1000;
const MOVE_THROTTLE_MS = 20;
const RIGHT_CLICK_SLOP_PX = 10;
const MIN_SIZE_INCREASE = 0.25;

class ClasspackCrosshairs extends foundry.canvas.placeables.MeasuredTemplate {
  static ERROR_TEXTURE = HAZARD_ICON;

  constructor(config = {}, callbacks = {}) {
    const params = {
      t: config.shape ?? "circle",
      user: game.user.id,
      distance: config.size,
      x: config.x,
      y: config.y,
      width: 1,
      texture: config.texture,
      direction: config.direction,
      document: { fillColor: config.fillColor }
    };

    super(new CONFIG.MeasuredTemplate.documentClass(params, { parent: canvas.scene }));

    this.icon = config.icon ?? ClasspackCrosshairs.ERROR_TEXTURE;
    this.label = config.label;
    this.labelOffset = config.labelOffset;
    this.tag = config.tag;
    this.drawIcon = config.drawIcon;
    this.drawOutline = config.drawOutline;
    this.fillAlpha = config.fillAlpha;
    this.tileTexture = config.tileTexture;
    this.lockSize = config.lockSize;
    this.lockPosition = config.lockPosition;
    this.resolution = config.resolution;
    this.hooks = callbacks ?? {};

    this.inFlight = false;
    this.cancelled = true;
    this.radius = this.document.distance * this.scene.grid.size / 2;

    this._listeners = [];
    this._rightClick = { x: 0, y: 0 };
    this._lastMove = 0;
    this._armedAt = 0;
  }

  static defaultCrosshairsConfig() {
    return {
      size: canvas.dimensions.distance,
      icon: TARGET_ICON,
      label: "",
      labelOffset: { x: 0, y: 0 },
      tag: "crosshairs",
      drawIcon: true,
      drawOutline: true,
      resolution: 2,
      fillAlpha: 0,
      tileTexture: false,
      lockSize: true,
      lockPosition: false,
      rememberControlled: false,
      texture: null,
      direction: 0,
      fillColor: game.user.color
    };
  }

  /**
   * Show a crosshair and resolve with its final template data once the user
   * confirms (or with `cancelled: true` once they cancel).
   */
  static async showCrosshairs(config = {}, callbacks = {}) {
    let remembered = [];
    config = foundry.utils.mergeObject(config, ClasspackCrosshairs.defaultCrosshairsConfig(), { overwrite: false });

    if (config.rememberControlled) remembered = canvas.tokens.controlled;

    const placed = "x" in config || "y" in config;
    if (!placed) {
      const pointer = canvas.app.renderer.events.pointer.getLocalPosition(canvas.app.stage);
      Object.assign(config, ClasspackCrosshairs.getSnappedPosition(pointer, config.resolution));
    }

    const crosshair = new ClasspackCrosshairs(config, callbacks);
    await crosshair.drawPreview();
    const result = crosshair.toObject();

    for (const token of remembered) token.control({ releaseOthers: false });

    return result;
  }

  static collectPlaceables(template, type = "Token", contains = ClasspackCrosshairs._containsCenter) {
    const types = Array.isArray(type) ? type : [type];
    const collected = {};

    for (const collection of types) {
      collected[collection] = template.scene
        .getEmbeddedCollection(collection)
        .filter(placeable => contains(placeable.object, template));
    }

    return Array.isArray(type) ? collected : collected[types[0]];
  }

  static _containsCenter(placeable, template) {
    return Math.hypot(placeable.center.x - template.x, placeable.center.y - template.y) <= template.radius;
  }

  static getCrosshair(tag) {
    return canvas.templates.preview.children.find(child => child.tag === tag);
  }

  static getSnappedPosition({ x, y }, resolution) {
    const shift = resolution < 0 ? canvas.grid.size / 2 : 0;
    const snapped = canvas.grid.getSnappedPoint({ x: x - shift, y: y - shift }, { mode: 1, resolution });
    return { x: snapped.x + shift, y: snapped.y + shift };
  }

  toObject() {
    const result = foundry.utils.mergeObject(this.document.toObject(), {
      cancelled: this.cancelled,
      scene: this.scene,
      radius: this.radius,
      size: this.document.distance
    });
    delete result.width;
    return result;
  }

  /* -------------------------------------------------------------------- *
   *  Rendering
   * -------------------------------------------------------------------- */

  async drawPreview() {
    await this.draw();
    this.layer.preview.addChild(this);
    this.layer.interactiveChildren = false;
    this.inFlight = true;

    this._bind();
    this.hooks?.show?.(this);
    await this.waitFor(() => !this.inFlight, -1);
    this._unbind();

    return this;
  }

  async draw() {
    this.clear();

    const texture = this.document.texture;
    this._texture = texture ? await loadTexture(texture, { fallback: HAZARD_ICON }) : null;

    this.template = this.addChild(new PIXI.Graphics());
    this.controlIcon = this.addChild(this._makeMarker());
    this.ruler = this.addChild(this._makeCaption());

    this.refresh();
    if (this.id) this.activateListeners();

    return this;
  }

  _makeCaption() {
    const style = CONFIG.canvasTextStyle.clone();
    style.fontSize = Math.max(Math.round(0.36 * canvas.dimensions.size * 12) / 12, 36);
    const caption = new foundry.canvas.containers.PreciseText(null, style);
    caption.anchor.set(0, 0);
    return caption;
  }

  _makeMarker() {
    const size = Math.max(20 * Math.round(0.5 * canvas.dimensions.size / 20), 40);
    const marker = new foundry.canvas.containers.ControlIcon({ texture: this.icon, size });
    marker.visible = this.drawIcon;
    marker.pivot.set(0.5 * size, 0.5 * size);
    marker.angle = this.document.direction;
    return marker;
  }

  _layoutCaption() {
    this.ruler.text = this.label;
    this.ruler.position.set(
      -this.ruler.width / 2 + this.labelOffset.x,
      this.template.height / 2 + 5 + this.labelOffset.y
    );
  }

  refresh() {
    if (!this.template || this._destroyed) return this;

    const template = this.document;
    const cellSize = canvas.dimensions.size;
    this.position.set(template.x, template.y);

    const reach = template.distance * cellSize / 2;
    this.ray = foundry.canvas.geometry.Ray.fromAngle(
      template.x,
      template.y,
      Math.toRadians(template.direction),
      reach
    );
    this.t = this.computeShape(this);

    this.template
      .clear()
      .lineStyle(this._borderThickness, this.document.borderColor, this.drawOutline ? OUTLINE_ALPHA : 0);

    if (this._texture) {
      const scale = this.tileTexture ? 1 : (2 * reach) / this._texture.width;
      const shift = this.tileTexture ? 0 : reach;
      this.template.beginTextureFill({
        texture: this._texture,
        matrix: new PIXI.Matrix().scale(scale, scale).translate(-shift, -shift)
      });
    } else {
      this.template.beginFill(this.document.fillColor, this.fillAlpha);
    }

    this.template.drawShape(this.t);

    this.controlIcon.visible = this.drawIcon;
    this.controlIcon.border.visible = this._hover;
    this.controlIcon.angle = template.direction;

    this._layoutCaption();
    return this;
  }

  get layer() {
    return canvas.activeLayer;
  }

  /* -------------------------------------------------------------------- *
   *  Pointer interaction
   * -------------------------------------------------------------------- */

  _bind() {
    this._unbind();
    this._armedAt = Date.now();
    this._lastMove = 0;

    this._moveFn = this._onMove.bind(this);
    this._downFn = this._onDown.bind(this);
    this._wheelFn = this._onWheel.bind(this);
    this._rightDownFn = this._onRightDown.bind(this);
    this._rightUpFn = this._onRightUp.bind(this);

    canvas.stage.on("pointermove", this._moveFn);
    canvas.stage.on("pointerdown", this._downFn);
    canvas.app.view.onwheel = this._wheelFn;
    canvas.app.view.onmousedown = this._rightDownFn;
    canvas.app.view.onmouseup = this._rightUpFn;
  }

  _unbind() {
    if (this._moveFn) canvas.stage.off("pointermove", this._moveFn);
    if (this._downFn) canvas.stage.off("pointerdown", this._downFn);
    canvas.app.view.onwheel = null;
    canvas.app.view.onmousedown = null;
    canvas.app.view.onmouseup = null;

    this._moveFn = null;
    this._downFn = null;
    this._wheelFn = null;
    this._rightDownFn = null;
    this._rightUpFn = null;
  }

  /** Stop the interaction and tear the preview template down. */
  _finish() {
    this.inFlight = false;
    this._unbind();
    this.actorSheet?.maximize?.();
    this.layer.interactiveChildren = true;

    setTimeout(() => {
      if (this.template && !this.template.destroyed) this.template.destroy();
      this._destroyed = true;
      if (this.parent) this.layer.preview.removeChild(this);
    }, 0);
  }

  _onMove(event) {
    event.stopPropagation();
    if (this.lockPosition) return;

    const now = Date.now();
    if (now - this._lastMove <= MOVE_THROTTLE_MS) return;

    const pointer = event.data.getLocalPosition(this.layer);
    this.document.updateSource(ClasspackCrosshairs.getSnappedPosition(pointer, this.resolution));
    this.refresh();
    this._lastMove = now;

    if (now - this._armedAt > PAN_AFTER_MS) canvas._onDragCanvasPan(event.data.originalEvent);
  }

  _onDown(event) {
    if (event.data?.button !== 0) return;
    event.stopPropagation();

    const template = this.document;
    this.radius = template.distance * this.scene.grid.size / 2;
    this.cancelled = false;
    this.document.updateSource(ClasspackCrosshairs.getSnappedPosition(template, this.resolution));
    this._finish();

    return true;
  }

  _onWheel(event) {
    if (event.ctrlKey) event.preventDefault();
    if (!event.altKey) event.stopPropagation();

    const turn = canvas.grid.type > CONST.GRID_TYPES.SQUARE ? 30 : 15;
    const delta = (event.ctrlKey ? turn : 5) * Math.sign(event.deltaY);
    const template = this.document;

    if (event.shiftKey && !this.lockSize) {
      const distance = Math.max(template.distance + MIN_SIZE_INCREASE * Math.sign(event.deltaY), MIN_SIZE_INCREASE);
      this.document.updateSource({ distance });
      this.radius = distance * this.scene.grid.size / 2;
    } else if (!event.altKey) {
      this.document.updateSource({ direction: template.direction + delta });
    }

    this.refresh();
  }

  _onRightDown(event) {
    if (event.button === 2) this._rightClick = { x: event.screenX, y: event.screenY };
  }

  _onRightUp(event) {
    if (event.button !== 2) return;

    const close = (a, b) => Math.abs(a - b) < RIGHT_CLICK_SLOP_PX;
    if (close(this._rightClick.x, event.screenX) && close(this._rightClick.y, event.screenY)) {
      this.cancelled = true;
      this._finish();
    }
  }

  /* -------------------------------------------------------------------- *
   *  Geometry / async helpers
   * -------------------------------------------------------------------- */

  computeShape(shape) {
    const result = shape._computeShape();

    if (shape.document.t === "rect") {
      const size = this.document.distance * this.scene.grid.size;
      result.height = size;
      result.width = size;
      result.x = this.scene.grid.size / -2;
      result.y = this.scene.grid.size / -2;
    } else if (shape.document.t === "circle" && !game.settings.get("core", "gridTemplates")) {
      const half = canvas.grid.size / 2;
      result.radius = Math.round(result.radius / half) * half;
    }

    return result;
  }

  async waitFor(condition, maxIterations = 600, interval = 100) {
    let iteration = 0;
    while (!condition(iteration, iteration * interval) && (maxIterations < 0 || iteration < maxIterations)) {
      iteration++;
      await this.wait(interval);
    }
    return iteration !== maxIterations;
  }

  async wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Aim a crosshair from a token, optionally limiting it to a maximum range.
 * Returns the chosen template data plus a `valid` flag describing whether the
 * final position passed the range / collision checks.
 */
async function aimCrosshair({
  token,
  maxRange,
  crosshairsConfig,
  centerpoint,
  drawBoundries,
  customCallbacks,
  trackDistance = true,
  fudgeDistance = 0,
  validityFunctions = []
}) {
  let boundaryGraphics;
  let boundaryContainer;
  let travelled = 0;
  let offset = 0;

  if (maxRange) maxRange = Number(maxRange);

  if (!centerpoint) {
    const halfWidth = token.document.width / 2;
    offset += canvas.grid.distance * Math.floor(halfWidth);
    if (!fudgeDistance || offset === halfWidth * canvas.grid.distance) fudgeDistance = 2.5;
    fudgeDistance += offset;
  }

  centerpoint = centerpoint ?? token.center;

  let valid = true;

  const hooks = {
    show: async crosshair => {
      if (maxRange && drawBoundries) {
        const radius = canvas.grid.size * ((maxRange + fudgeDistance + offset) / canvas.grid.distance);
        boundaryGraphics = new PIXI.Graphics();
        boundaryGraphics.lineStyle(5, 0xFFFFFF);
        if (game.settings.get("core", "gridTemplates")
          && game.settings.get("core", "gridDiagonals") !== CONST.GRID_DIAGONALS.EXACT) {
          boundaryGraphics.drawPolygon(canvas.grid.getCircle(centerpoint, maxRange + fudgeDistance + offset));
        } else {
          boundaryGraphics.drawCircle(centerpoint.x, centerpoint.y, radius);
        }
        boundaryGraphics.tint = 0x32CD32;

        boundaryContainer = new PIXI.Container();
        boundaryContainer.addChild(boundaryGraphics);
        canvas.drawings.addChild(boundaryContainer);
      }

      while (crosshair.inFlight) {
        await sleep(100);
        if (!trackDistance) continue;

        travelled = Math.max(0, canvas.grid.measurePath([centerpoint, crosshair]).distance.toNearest(0.01) - offset);
        const blocked = token.checkCollision(crosshair, { origin: token.center, type: "move", mode: "any" });
        const outOfRange = maxRange ? travelled > maxRange : false;
        const rejected = validityFunctions.some(test => !test(crosshair));
        valid = !blocked && !outOfRange && !rejected;

        crosshair.icon = valid ? (crosshairsConfig?.icon ?? crosshair.icon) : HAZARD_ICON;
        if (boundaryGraphics) boundaryGraphics.tint = valid ? 0x32CD32 : 0xFF0000;
        crosshair.label = `${travelled}/${maxRange}ft.`;
        crosshair.draw();
      }
    },
    ...(customCallbacks ?? {})
  };

  let config = trackDistance ? { label: "0ft" } : {};
  config = { ...config, ...crosshairsConfig };
  if (token?.document?.rotation) config.direction = token.document.rotation;

  if (!maxRange) return await ClasspackCrosshairs.showCrosshairs(config);

  const result = await ClasspackCrosshairs.showCrosshairs(config, hooks);

  boundaryGraphics?.destroy();
  boundaryContainer?.destroy();

  return { ...result, valid };
}

export { ClasspackCrosshairs, aimCrosshair };
