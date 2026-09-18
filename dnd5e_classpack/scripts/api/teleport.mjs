/**
 * Token teleportation driven by the ClassPack crosshair helper.
 *
 * Three entry points are provided:
 *
 * - `ClasspackTeleport.point(tokens, options)`  pick any point within range
 * - `ClasspackTeleport.target(token, ref, ...)`  place tokens relative to a reference token
 * - `ClasspackTeleport.group(tokens, ref, ...)`  move a group, preserving spacing
 *
 * The final token updates are written through `options.commit`, which lets
 * callers reroute them (for example to a GM client over socketlib) when the
 * local user is not allowed to move the tokens.
 */

import { mergeMultiple, resolveOriginPoint } from "./utils.mjs";
import { aimCrosshair, ClasspackCrosshairs } from "./crosshairs.mjs";

const DEFAULTS = {
  animation: "none",
  isSynchronous: true,
  crosshairsConfig: {},
  callbacks: {},
  range: 100,
  updates: {},
  minimizeSheet: true,
  centerpoint: null,
  isGroup: false,
  validityFunctions: undefined,
  commit: undefined
};

class ClasspackTeleport {
  constructor(tokens, reference, options = {}) {
    this.tokens = Array.isArray(tokens) ? tokens : [tokens];
    this.reference = reference ?? this.tokens[0];
    this.options = { ...DEFAULTS, ...options };
    this.isGroup = !!this.options.isGroup;
    this.updates = this.options.updates ?? {};
    this.art = this.tokens[0]?.document?.texture?.src;
    this.commit = this.options.commit ?? (updates => this.write(updates));
    this.result = null;
  }

  static async group(tokens, reference, options = {}) {
    const teleport = new ClasspackTeleport(tokens, reference, { ...options, isGroup: true });
    teleport.art = reference.document.texture.src;
    await teleport.go(teleport.referenceCrosshairs, teleport.options.minimizeSheet);
  }

  static async target(token, reference, options = {}) {
    const teleport = new ClasspackTeleport(token, reference, options);
    await teleport.go(teleport.tokenCrosshairs, teleport.options.minimizeSheet);
  }

  static async point(tokens, options = {}) {
    const list = Array.isArray(tokens) ? tokens : [tokens];
    if (!list.length) return;

    const teleport = new ClasspackTeleport(list, list[0], { ...options, isGroup: list.length > 1 });
    teleport.art = list[0].document.texture.src;
    await teleport.go(teleport.referenceCrosshairs, teleport.options.minimizeSheet);
  }

  /* -------------------------------------------------------------------- *
   *  Crosshair configuration
   * -------------------------------------------------------------------- */

  crosshairsFor(token) {
    const width = token.document.width;
    return mergeMultiple(
      ClasspackCrosshairs.defaultCrosshairsConfig(),
      {
        size: canvas.grid.distance * width / 2,
        icon: this.art,
        resolution: (this.updates?.token?.width ?? width) % 2 ? 1 : -1
      },
      this.options.crosshairsConfig ?? {}
    );
  }

  get referenceCrosshairs() {
    return this.crosshairsFor(this.reference);
  }

  get tokenCrosshairs() {
    return this.crosshairsFor(this.tokens[0]);
  }

  /* -------------------------------------------------------------------- *
   *  Movement
   * -------------------------------------------------------------------- */

  /**
   * Top-left position the reference token would occupy at the chosen point.
   */
  get destination() {
    return {
      x: this.result.x - this.reference.w / 2,
      y: this.result.y - this.reference.h / 2
    };
  }

  relativeSpot(token) {
    const base = this.destination;
    return {
      rotation: this.result.direction,
      x: base.x - (this.reference.x - token.x),
      y: base.y - (this.reference.y - token.y)
    };
  }

  async go(crosshairsConfig, minimizeSheet = true) {
    const sheet = this.reference.actor?.sheet;
    if (sheet?.rendered && minimizeSheet) sheet.minimize();

    const aim = {
      token: this.reference,
      maxRange: this.options.range,
      crosshairsConfig,
      drawBoundries: true,
      customCallbacks: this.options.callbacks,
      validityFunctions: this.options.validityFunctions
    };
    if (this.options.centerpoint) aim.centerpoint = await resolveOriginPoint(this.options.centerpoint);

    this.result = await aimCrosshair(aim);

    if (!this.result.cancelled) {
      if (this.isGroup) await this.moveGroup();
      else await this.moveSingle();
    }

    if (sheet?.rendered && minimizeSheet) sheet.maximize();
    return this.result;
  }

  async moveSingle() {
    const token = this.tokens[0];
    const spot = { rotation: this.result.direction, x: this.destination.x, y: this.destination.y };

    await this.animate("pre", token, spot);
    await this.commit([mergeMultiple(this.updates, spot, { _id: token.id })]);
    await this.animate("post", token, spot);
  }

  async moveGroup() {
    if (this.options.isSynchronous === false) await this.moveSeparately();
    else await this.moveTogether();
  }

  async moveSeparately() {
    await Promise.all(this.tokens.map(async token => {
      const spot = this.relativeSpot(token);
      await this.animate("pre", token, spot);
      await this.commit([mergeMultiple(this.updates, spot, { _id: token.id })]);
      await this.animate("post", token, spot);
    }));
  }

  async moveTogether() {
    const spots = this.tokens.map(token => this.relativeSpot(token));

    await Promise.all(this.tokens.map((token, index) => this.animate("pre", token, spots[index])));
    await this.commit(this.tokens.map((token, index) => mergeMultiple(this.updates, { _id: token.id }, spots[index])));
    await Promise.all(this.tokens.map((token, index) => this.animate("post", token, spots[index])));
  }

  async write(updates) {
    await canvas.scene.updateEmbeddedDocuments("Token", updates, { isPaste: true });
  }

  async animate(phase, token, spot) {
    const bank = ClasspackTeleport.animations[this.options.animation] ?? ClasspackTeleport.animations.none;
    const effect = bank?.[phase];
    if (typeof effect === "function") await effect(token, spot);
  }
}

ClasspackTeleport.animations = {
  none: { pre: null, post: null }
};

export { ClasspackTeleport };
