/**
 * Teleport (modelled after chris-premades Teleport).
 */

import { mergeMultiple } from "./utils.mjs";
import { aimCrosshair, ClasspackCrosshairs } from "./crosshairs.mjs";

/* -------------------------------------------------------------------------- *
 *  Teleport (modelled after chris-premades Teleport)
 * -------------------------------------------------------------------------- */

class ClasspackTeleport {
  constructor(tokens, controllingToken, options) {
    this.tokens = Array.isArray(tokens) ? tokens : [tokens];
    this.controllingToken = controllingToken ?? this.tokens[0];
    this.tokenTexture = this.tokens[0].document.texture.src;
    this.options = options;
    this.updates = options?.updates ?? {};
  }

  static async group(tokens, target, options = {}) {
    const defaults = {
      animation: "none",
      isSynchronous: true,
      crosshairsConfig: {},
      callbacks: {},
      range: 100,
      updates: {},
      minimizeSheet: true,
      centerpoint: null
    };
    const merged = foundry.utils.mergeObject(defaults, options);
    merged.isGroup = true;
    const teleport = new ClasspackTeleport(tokens, target, merged);
    teleport.tokenTexture = target.document.texture.src;
    await teleport.go(teleport.crosshairsConfig, merged.minimizeSheet);
  }

  static async target(token, target, options = {}) {
    const defaults = {
      animation: "none",
      crosshairsConfig: {},
      callbacks: {},
      range: 100,
      updates: {},
      minimizeSheet: true,
      centerpoint: null
    };
    const merged = foundry.utils.mergeObject(defaults, options);
    const teleport = new ClasspackTeleport(token, target, merged);
    await teleport.go(teleport.crosshairsConfigTarget, merged.minimizeSheet);
  }

  async go(crosshairsConfig, minimizeSheet = true) {
    this.controllingToken.actor?.sheet?.rendered && minimizeSheet && this.controllingToken.actor.sheet.minimize();

    const aimConfig = {
      token: this.controllingToken,
      maxRange: this.options.range,
      crosshairsConfig,
      drawBoundries: true,
      customCallbacks: this.options?.callbacks,
      validityFunctions: this.options?.validityFunctions
    };
    if (this.options.centerpoint) aimConfig.centerpoint = this.options.centerpoint;

    this.template = await aimCrosshair(aimConfig);

    if (!this.template.cancelled) {
      if (this.options?.isGroup) await this._moveGroup();
      else await this._move();
    }

    this.controllingToken.actor?.sheet?.rendered && minimizeSheet && this.controllingToken.actor.sheet.maximize();
    return this.template;
  }

  async _move() {
    const token = this.tokens[0];
    const coords = { rotation: this.template.direction, x: this.coords.selected.x, y: this.coords.selected.y };

    await this._playAnimation("pre", token, coords);
    const update = mergeMultiple(this.updates, coords, { _id: token.id });
    await this._updateTokens([update]);
    await this._playAnimation("post", token, coords);
  }

  async _moveGroup() {
    if (this.options?.isSynchronous === false) await this._nonSync();
    else await this._sync();
  }

  async _nonSync() {
    await Promise.all(this.tokens.map(async token => {
      const coords = this.getCoords(token);
      await this._playAnimation("pre", token, coords);
      const update = mergeMultiple(this.updates, coords, { _id: token.id });
      await this._updateTokens([update]);
      await this._playAnimation("post", token, coords);
    }));
  }

  async _sync() {
    const coordsList = this.tokens.map(token => this.getCoords(token));

    await Promise.all(this.tokens.map(async (token, index) => {
      await this._playAnimation("pre", token, coordsList[index]);
    }));

    const updates = this.tokens.map((token, index) => mergeMultiple(this.updates, { _id: token.id }, coordsList[index]));
    await this._updateTokens(updates);

    await Promise.all(this.tokens.map(async (token, index) => {
      await this._playAnimation("post", token, coordsList[index]);
    }));
  }

  async _updateTokens(updates) {
    await canvas.scene.updateEmbeddedDocuments("Token", updates, { isPaste: true });
  }

  async _playAnimation(phase, token, coords) {
    const animation = this.options?.animation ?? "none";
    const effects = ClasspackTeleport.animations[animation] ?? ClasspackTeleport.animations.none;
    const fn = effects?.[phase];
    if (typeof fn === "function") await fn(token, coords);
  }

  getCoords(token) {
    const dx = this.controllingToken.x - token.x;
    const dy = this.controllingToken.y - token.y;
    return {
      rotation: this.template.direction,
      x: this.coords.selected.x - dx,
      y: this.coords.selected.y - dy
    };
  }

  get crosshairsConfig() {
    const base = {
      size: canvas.grid.distance * this.controllingToken.document.width / 2,
      icon: this.tokenTexture,
      resolution: (this.updates?.token?.width ?? this.controllingToken.document.width) % 2 ? 1 : -1
    };
    return mergeMultiple(ClasspackCrosshairs.defaultCrosshairsConfig(), base, this.options?.crosshairsConfig ?? {});
  }

  get crosshairsConfigTarget() {
    const base = {
      size: canvas.grid.distance * this.tokens[0].document.width / 2,
      icon: this.tokenTexture,
      resolution: (this.updates?.token?.width ?? this.tokens[0].document.width) % 2 ? 1 : -1
    };
    return mergeMultiple(ClasspackCrosshairs.defaultCrosshairsConfig(), base, this.options?.crosshairsConfig ?? {});
  }

  get coords() {
    return {
      original: { x: this.controllingToken.x, y: this.controllingToken.y },
      selected: {
        x: this.template?.x - this.controllingToken.w / 2,
        y: this.template?.y - this.controllingToken.h / 2
      }
    };
  }
}

ClasspackTeleport.animations = {
  none: { pre: null, post: null }
};

export { ClasspackTeleport };
