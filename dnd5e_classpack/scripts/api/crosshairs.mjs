/**
 * Crosshairs helper (modelled after chris-premades Crosshairs).
 */

import { sleep } from "./utils.mjs";

/* -------------------------------------------------------------------------- *
 *  Crosshairs helper (modelled after chris-premades Crosshairs)
 * -------------------------------------------------------------------------- */

class ClasspackCrosshairs extends foundry.canvas.placeables.MeasuredTemplate {
  constructor(config = {}, callbacks = {}) {
    const templateData = {
      t: config.shape ?? "circle",
      user: game.user.id,
      distance: config.size,
      x: config.x,
      y: config.y,
      document: { fillColor: config.fillColor },
      width: 1,
      texture: config.texture,
      direction: config.direction
    };

    super(new CONFIG.MeasuredTemplate.documentClass(templateData, { parent: canvas.scene }));

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
    this.callbacks = callbacks;
    this.inFlight = false;
    this.cancelled = true;
    this.rightX = 0;
    this.rightY = 0;
    this.radius = this.document.distance * this.scene.grid.size / 2;
  }

  static defaultCrosshairsConfig() {
    return {
      size: canvas.dimensions.distance,
      icon: "icons/svg/dice-target.svg",
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

  static async showCrosshairs(config = {}, callbacks = {}) {
    let controlledTokens = [];
    config = foundry.utils.mergeObject(config, ClasspackCrosshairs.defaultCrosshairsConfig(), { overwrite: false });

    if (config.rememberControlled) {
      controlledTokens = canvas.tokens.controlled;
    }

    if (!Object.prototype?.hasOwnProperty?.call(config, "x") && !Object.prototype?.hasOwnProperty?.call(config, "y")) {
      const pointer = canvas.app.renderer.events.pointer.getLocalPosition(canvas.app.stage);
      const snapped = ClasspackCrosshairs.getSnappedPosition(pointer, config.resolution);
      config.x = snapped.x;
      config.y = snapped.y;
    }

    const crosshair = new ClasspackCrosshairs(config, callbacks);
    await crosshair.drawPreview();
    const result = crosshair.toObject();

    for (const token of controlledTokens) token.control({ releaseOthers: false });

    return result;
  }

  toObject() {
    const obj = foundry.utils.mergeObject(this.document.toObject(), {
      cancelled: this.cancelled,
      scene: this.scene,
      radius: this.radius,
      size: this.document.distance
    });
    delete obj.width;
    return obj;
  }

  static collectPlaceables(template, type = "Token", contains = ClasspackCrosshairs._containsCenter) {
    const multipleTypes = Array.isArray(type);
    const types = multipleTypes ? type : [type];

    const collections = types.reduce((acc, collectionType) => {
      const collection = template.scene.getEmbeddedCollection(collectionType).filter(placeable => contains(placeable.object, template));
      acc[collectionType] = collection;
      return acc;
    }, {});

    return multipleTypes ? collections : collections[types[0]];
  }

  static _containsCenter(placeable, template) {
    return Math.hypot(placeable.center.x - template.x, placeable.center.y - template.y) <= template.radius;
  }

  static getCrosshair(tag) {
    return canvas.templates.preview.children.find(t => t.tag === tag);
  }

  static getSnappedPosition({ x, y }, resolution) {
    const offset = resolution < 0 ? canvas.grid.size / 2 : 0;
    const point = canvas.grid.getSnappedPoint({ x: x - offset, y: y - offset }, { mode: 1, resolution });
    return { x: point.x + offset, y: point.y + offset };
  }

  static ERROR_TEXTURE = "icons/svg/hazard.svg";

  async drawPreview() {
    await this.draw();
    this.layer.preview.addChild(this);
    this.layer.interactiveChildren = false;
    this.inFlight = true;
    this.activatePreviewListeners();
    this.callbacks?.show?.(this);
    await this.waitFor(() => !this.inFlight, -1);
    if (this.activeHandlers) this.clearHandlers();
    return this;
  }

  async draw() {
    this.clear();
    const texture = this.document.texture;
    this._texture = texture ? await loadTexture(texture, { fallback: "icons/svg/hazard.svg" }) : null;
    this.template = this.addChild(new PIXI.Graphics);
    this.controlIcon = this.addChild(this._drawControlIcon());
    this.ruler = this.addChild(this._drawRulerText());
    this.refresh();
    this._setRulerText();
    if (this.id) this.activateListeners();
    return this;
  }

  _setRulerText() {
    this.ruler.text = this.label;
    this.ruler.position.set(-this.ruler.width / 2 + this.labelOffset.x, this.template.height / 2 + 5 + this.labelOffset.y);
  }

  _drawRulerText() {
    const style = CONFIG.canvasTextStyle.clone();
    style.fontSize = Math.max(Math.round(0.36 * canvas.dimensions.size * 12) / 12, 36);
    const text = new foundry.canvas.containers.PreciseText(null, style);
    text.anchor.set(0, 0);
    return text;
  }

  _drawControlIcon() {
    const size = Math.max(20 * Math.round(0.5 * canvas.dimensions.size / 20), 40);
    const icon = new foundry.canvas.containers.ControlIcon({ texture: this.icon, size });
    icon.visible = this.drawIcon;
    icon.pivot.set(0.5 * size, 0.5 * size);
    icon.angle = this.document.direction;
    return icon;
  }

  refresh() {
    if (!this.template || this._destroyed) return;
    const dimensions = canvas.dimensions;
    const template = this.document;
    this.position.set(template.x, template.y);

    let { direction, distance } = template;
    distance *= dimensions.size / 2;
    direction = Math.toRadians(direction);

    this.ray = foundry.canvas.geometry.Ray.fromAngle(template.x, template.y, direction, distance);
    this.t = this.computeShape(this);

    this.template.clear().lineStyle(this._borderThickness, this.document.borderColor, this.drawOutline ? 0.75 : 0);

    if (this._texture) {
      const scale = this.tileTexture ? 1 : (2 * distance) / this._texture.width;
      const translate = this.tileTexture ? 0 : distance;
      this.template.beginTextureFill({
        texture: this._texture,
        matrix: new PIXI.Matrix().scale(scale, scale).translate(-translate, -translate)
      });
    } else {
      this.template.beginFill(this.document.fillColor, this.fillAlpha);
    }

    this.template.drawShape(this.t);

    if (this.drawIcon) {
      this.controlIcon.visible = true;
      this.controlIcon.border.visible = this._hover;
      this.controlIcon.angle = template.direction;
    }

    this._setRulerText();
    return this;
  }

  get layer() {
    return canvas.activeLayer;
  }

  activatePreviewListeners() {
    this.moveTime = 0;
    this.initTime = Date.now();
    this.removeAllListeners();

    this.activeMoveHandler = this._mouseMoveHandler.bind(this);
    this.activeLeftClickHandler = this._leftClickHandler.bind(this);
    this.rightDownHandler = this._rightDownHandler.bind(this);
    this.rightUpHandler = this._rightUpHandler.bind(this);
    this.activeWheelHandler = this._mouseWheelHandler.bind(this);
    this.clearHandlers = this._clearHandlers.bind(this);

    canvas.stage.on("pointermove", this.activeMoveHandler);
    canvas.stage.on("pointerdown", this.activeLeftClickHandler);
    canvas.app.view.onwheel = this.activeWheelHandler;
    canvas.app.view.onmousedown = this.rightDownHandler;
    canvas.app.view.onmouseup = this.rightUpHandler;
  }

  _mouseMoveHandler(event) {
    event.stopPropagation();
    if (this.lockPosition) return;

    const now = Date.now();
    if (now - this.moveTime <= 20) return;

    const pointer = event.data.getLocalPosition(this.layer);
    const { x, y } = ClasspackCrosshairs.getSnappedPosition(pointer, this.resolution);
    this.document.updateSource({ x, y });
    this.refresh();
    this.moveTime = now;

    if (now - this.initTime > 1000) canvas._onDragCanvasPan(event.data.originalEvent);
  }

  _leftClickHandler(event) {
    if (event.data?.button !== 0) return;
    event.stopPropagation();

    const template = this.document;
    const gridSize = this.scene.grid.size;
    const snapped = ClasspackCrosshairs.getSnappedPosition(this.document, this.resolution);

    this.radius = template.distance * gridSize / 2;
    this.cancelled = false;
    this.document.updateSource({ ...snapped });
    this.clearHandlers(event);
    return true;
  }

  _mouseWheelHandler(event) {
    if (event.ctrlKey) event.preventDefault();
    if (!event.altKey) event.stopPropagation();

    const step = canvas.grid.type > CONST.GRID_TYPES.SQUARE ? 30 : 15;
    const delta = event.ctrlKey ? step : 5;
    const template = this.document;
    const gridSize = this.scene.grid.size;

    if (event.shiftKey && !this.lockSize) {
      let distance = template.distance + 0.25 * Math.sign(event.deltaY);
      distance = Math.max(distance, 0.25);
      this.document.updateSource({ distance });
      this.radius = distance * gridSize / 2;
    } else if (!event.altKey) {
      const direction = template.direction + delta * Math.sign(event.deltaY);
      this.document.updateSource({ direction });
    }

    this.refresh();
  }

  _rightDownHandler(event) {
    if (event.button === 2) {
      this.rightX = event.screenX;
      this.rightY = event.screenY;
    }
  }

  _rightUpHandler(event) {
    if (event.button !== 2) return;
    const withinThreshold = (a, b) => Math.abs(a - b) < 10;
    if (withinThreshold(this.rightX, event.screenX) && withinThreshold(this.rightY, event.screenY)) {
      this.cancelled = true;
      this.clearHandlers(event);
    }
  }

  _clearHandlers(event) {
    this.inFlight = false;
    canvas.stage.off("pointermove", this.activeMoveHandler);
    canvas.stage.off("pointerdown", this.activeLeftClickHandler);
    canvas.app.view.onmousedown = null;
    canvas.app.view.onmouseup = null;
    canvas.app.view.onwheel = null;
    this.actorSheet?.maximize?.();
    this.layer.interactiveChildren = true;
    setTimeout(() => {
      if (this.template && !this.template.destroyed) this.template.destroy();
      this._destroyed = true;
      if (this.parent) this.layer.preview.removeChild(this);
    }, 0);
  }

  computeShape(shape) {
    const result = shape._computeShape();
    if (shape.document.t === "rect") {
      const size = this.document.distance * this.scene.grid.size;
      result.height = size;
      result.width = size;
      result.y = this.scene.grid.size / -2;
      result.x = this.scene.grid.size / -2;
    } else if (shape.document.t !== "ray" && shape.document.t === "circle" && !game.settings.get("core", "gridTemplates")) {
      result.radius = Math.round(result.radius / (canvas.grid.size / 2)) * (canvas.grid.size / 2);
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
 * Aim a crosshair from a token, optionally limiting its range.
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
  let boundaryGraphics, boundaryContainer;
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

  const callbacks = {
    show: async crosshair => {
      if (maxRange && drawBoundries) {
        const radius = canvas.grid.size * ((maxRange + fudgeDistance + offset) / canvas.grid.distance);
        boundaryGraphics = new PIXI.Graphics();
        boundaryGraphics.lineStyle(5, 0xFFFFFF);
        if (game.settings.get("core", "gridTemplates") && game.settings.get("core", "gridDiagonals") !== CONST.GRID_DIAGONALS.EXACT) {
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
        if (trackDistance) {
          travelled = canvas.grid.measurePath([centerpoint, crosshair]).distance.toNearest(0.01);
          travelled = Math.max(0, travelled - offset);
          const blocked = token.checkCollision(crosshair, { origin: token.center, type: "move", mode: "any" });
          const outOfRange = maxRange ? travelled > maxRange : false;
          const invalid = validityFunctions.some(fn => !fn(crosshair));
          if (blocked || outOfRange || invalid) {
            crosshair.icon = "icons/svg/hazard.svg";
            if (boundaryGraphics) boundaryGraphics.tint = 0xFF0000;
            valid = false;
          } else {
            crosshair.icon = crosshairsConfig?.icon ?? crosshair.icon;
            if (boundaryGraphics) boundaryGraphics.tint = 0x32CD32;
            valid = true;
          }
          crosshair.draw();
          crosshair.label = `${travelled}/${maxRange}ft.`;
        }
      }
    },
    ...customCallbacks ?? {}
  };

  let config = {};
  if (trackDistance) config.label = "0ft";
  config = { ...config, ...crosshairsConfig };
  if (token?.document?.rotation) config.direction = token.document.rotation;

  if (!maxRange) return await ClasspackCrosshairs.showCrosshairs(config);

  const result = await ClasspackCrosshairs.showCrosshairs(config, callbacks);

  if (boundaryGraphics) boundaryGraphics.destroy();
  if (boundaryContainer) boundaryContainer.destroy();

  return { ...result, valid };
}


export { ClasspackCrosshairs, aimCrosshair };
