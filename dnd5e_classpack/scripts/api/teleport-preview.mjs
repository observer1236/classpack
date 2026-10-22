import { tokenDocument } from "./geometry.mjs";

/** Client-only native Token renderers. No scene documents, light or vision are created. */
export class TeleportPreview {
  constructor(tokens, { alpha = 1 } = {}) {
    this.tokens = tokens;
    this.scene = tokenDocument(tokens[0]).parent;
    this.alpha = Number.isFinite(alpha) ? Math.max(0, Math.min(1, alpha)) : 1;
    this.entries = [];
    this.closed = false;
  }

  update(positions, valid) {
    if (this.closed || canvas.scene !== this.scene) return;
    this.positions = positions;
    this.valid = valid;
    if (!this.ready) return this.ready = this.draw();
    for (const entry of this.entries) this.refresh(entry);
  }

  async draw() {
    const TokenClass = CONFIG.Token.objectClass;
    if (!TokenClass || !globalThis.PIXI?.Container) return;
    this.container = new PIXI.Container();
    this.container.eventMode = "none";
    this.container.interactiveChildren = false;
    this.container.alpha = this.alpha;
    canvas.stage.addChild(this.container);
    const results = await Promise.allSettled(this.tokens.map(async (token, index) => {
      const source = tokenDocument(token);
      if (this.closed || canvas.scene !== this.scene || typeof source.clone !== "function") return;
      // A separate ID avoids colliding with core drag/config previews or another teleport.
      // Do not use token.clone(): that replaces the real Token's _preview reference.
      const document = source.clone({ _id: foundry.utils.randomID() }, { keepId: true });
      const preview = new TokenClass(document);
      document._object = preview;
      preview._previewType = "api";
      preview.eventMode = "none";
      preview.interactiveChildren = false;
      preview.visible = false;
      const entry = { preview, index, alpha: document.alpha, tint: document.texture.tint };
      this.entries.push(entry);
      this.refresh(entry);
      await preview.draw();
      if (!this.closed && canvas.scene === this.scene && !this.container.destroyed && !preview.destroyed) {
        // Keep an in-flight native draw out of the stage's teardown traversal.
        // Token._draw can still allocate a mesh after a texture promise resolves.
        this.container.addChild(preview);
        preview.visible = true;
        this.refresh(entry);
      } else if (!preview.destroyed) preview.destroy({ children: true });
    }));
    const failure = results.find(result => result.status === "rejected");
    if (failure) throw failure.reason;
  }

  refresh({ preview, index, alpha, tint }) {
    if (this.closed || preview.destroyed || canvas.scene !== this.scene) return;
    const { _id, ...position } = this.positions[index];
    preview.document.updateSource({ ...position, alpha: (position.alpha ?? alpha) * this.alpha,
      "texture.tint": this.valid ? tint : "#ff3333" });
    preview.renderFlags.set({ refreshPosition: true, refreshRotation: true,
      refreshSize: true, refreshMesh: true, refreshElevation: true });
  }

  async destroy() {
    if (this.cleanup) return this.cleanup;
    this.closed = true;
    if (this.container && !this.container.destroyed) this.container.visible = false;
    for (const { preview } of this.entries) {
      preview.visible = false;
      if (preview.mesh) preview.mesh.visible = false;
    }
    // A late texture/video load must finish before its native renderer is destroyed.
    return this.cleanup = (async () => {
      await this.ready?.catch(() => {});
      for (const { preview } of this.entries) if (!preview.destroyed) preview.destroy({ children: true });
      if (this.container && !this.container.destroyed) {
        this.container.parent?.removeChild(this.container);
        this.container.destroy({ children: true });
      }
    })();
  }
}
