/**
 * ApplicationV2 dialog (modelled after chris-premades DialogApp).
 */

import { log, localize, sleep } from "./utils.mjs";

/* -------------------------------------------------------------------------- *
 *  ApplicationV2 dialog (modelled after chris-premades DialogApp)
 * -------------------------------------------------------------------------- */

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

class ClasspackDialogApp extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(args) {
    let title, content, inputs, buttons, options;
    if (args?.length) ([title, content, inputs, buttons, options] = args);

    super(options?.id ? { id: options.id } : {});

    if (args?.length) {
      this.position ??= {};
      this.position.width = options?.width ?? "auto";
      this.position.height = options?.height ?? "auto";
      this.windowTitle = game.i18n.localize(title);
      this.content = content;
      this.inputs = inputs ?? [];
      this.buttons = buttons;
      this.buttonTemplate = { type: "submit", label: "label", name: "name", action: "confirm" };
    }
  }

  static DEFAULT_OPTIONS = {
    tag: "form",
    form: {
      handler: ClasspackDialogApp.formHandler,
      submitOnChange: false,
      closeOnSubmit: false,
      id: "classpack-dialog-app-window"
    },
    actions: { confirm: ClasspackDialogApp.confirm },
    window: { title: "Default Title", contentClasses: ["standard-form"] }
  };

  static PARTS = {
    form: {
      template: "modules/dnd5e_classpack/templates/dialogApp.hbs",
      scrollable: [""]
    },
    footer: { template: "templates/generic/form-footer.hbs" }
  };

  static async dialog(...args) {
    return new Promise(resolve => {
      const app = new ClasspackDialogApp(args);
      app.addEventListener("close", () => resolve(null), { once: true });
      app.render({ force: true });
      app.submit = async result => {
        resolve(result);
        app.close();
      };
    });
  }

  static async formHandler(event, form, formData) {
    this.results = foundry.utils.expandObject(formData.object);
  }

  static async confirm(event, target) {
    await this.mergeResults(target.name);
  }

  async mergeResults(value) {
    if (value === "false") {
      this.submit({ buttons: false });
      return false;
    }
    while (this.results === undefined) await sleep(10);
    this.results.buttons = value === "true" || value;
    this.submit(this.results);
  }

  get title() {
    return this.windowTitle;
  }

  get results() {
    return this._results;
  }

  set results(value) {
    this._results = value;
  }

  get context() {
    return this._context;
  }

  set context(value) {
    this._context = value;
  }

  makeButton(label, name) {
    return { type: "submit", action: "confirm", label, name };
  }

  makeArray(min, max) {
    const values = [];
    for (let i = min; i < max + 1; i++) values.push(i);
    return values;
  }

  formatInputs() {
    const context = {};
    context.content = this.content;
    context.inputs = [];
    context.buttons = [];

    for (const [type, options, config] of this.inputs) {
      switch (type) {
        case "button": {
          const buttons = [];
          for (const option of options) {
            buttons.push({
              label: option.label,
              name: option.name,
              image: option.options?.image ?? undefined,
              tooltip: option.options?.tooltip ?? undefined,
              reference: option.options?.reference ?? undefined
            });
          }
          context.inputs.push({ isButton: true, displayAsRows: config?.displayAsRows ?? false, options: buttons });
          break;
        }
        case "checkbox": {
          const checkboxes = [];
          for (const option of options) {
            checkboxes.push({
              label: option.label,
              name: option.name,
              isChecked: option.options?.isChecked ?? false,
              image: option.options?.image ?? undefined
            });
          }
          context.inputs.push({
            isCheckbox: true,
            displayAsRows: config?.displayAsRows ?? false,
            options: checkboxes,
            totalMax: config?.totalMax ?? 99,
            currentNum: checkboxes.filter(o => o.isChecked).length
          });
          break;
        }
        case "radio": {
          const radios = [];
          for (const option of options) {
            radios.push({
              label: option.label,
              name: option.name,
              isChecked: option.options?.isChecked ?? false,
              image: option.options?.image ?? undefined
            });
          }
          context.inputs.push({
            isRadio: true,
            displayAsRows: config?.displayAsRows ?? false,
            options: radios,
            radioName: config?.radioName ?? "radio"
          });
          break;
        }
        case "selectAmount": {
          const amounts = [];
          for (const option of options) {
            amounts.push({
              label: option.label,
              name: option.name,
              minAmount: option.options?.minAmount ?? 0,
              maxAmount: option.options?.maxAmount ?? 10,
              currentAmount: option.options?.currentAmount ?? 0,
              currentMaxAmount: option.options?.maxAmount ?? 10,
              weight: option.options?.weight ?? 1,
              options: this.makeArray(option.options?.minAmount ?? 0, option.options?.maxAmount ?? 10),
              image: option.options?.image ?? undefined
            });
          }
          context.inputs.push({
            isSelectAmount: true,
            totalMax: config?.totalMax,
            displayAsRows: config?.displayAsRows ?? false,
            options: amounts
          });
          context.inputs[context.inputs.length - 1] = this.currentMaxAmounts(context.inputs[context.inputs.length - 1]);
          break;
        }
        case "selectMany": {
          const selects = [];
          for (const option of options) {
            const selected = option.options?.value ?? [];
            selects.push({
              label: option.label,
              name: option.name,
              value: selected,
              options: (option.options?.options ?? []).map(entry => ({
                label: entry.label,
                value: entry.value,
                isSelected: selected.includes(entry.value)
              })),
              image: option.options?.image ?? undefined
            });
          }
          context.inputs.push({ isSelectMany: true, displayAsRows: config?.displayAsRows ?? false, options: selects });
          break;
        }
        case "selectOption": {
          const selects = [];
          for (const option of options) {
            selects.push({
              label: option.label,
              name: option.name,
              currentValue: option.options?.currentValue ?? "none",
              options: option.options?.options ?? ["none"],
              image: option.options?.image ?? undefined
            });
          }
          context.inputs.push({ isSelectOption: true, displayAsRows: config?.displayAsRows ?? false, options: selects });
          break;
        }
        case "text": {
          const texts = [];
          for (const option of options) {
            texts.push({
              label: option.label,
              name: option.name,
              value: option.options?.currentValue ?? "",
              image: option.options?.image ?? undefined
            });
          }
          context.inputs.push({ isText: true, displayAsRows: config?.displayAsRows ?? false, options: texts });
          break;
        }
        case "number": {
          const numbers = [];
          for (const option of options) {
            numbers.push({
              label: option.label,
              name: option.name,
              value: option.options?.currentValue ?? 0,
              image: option.options?.image ?? undefined
            });
          }
          context.inputs.push({ isNumber: true, displayAsRows: config?.displayAsRows ?? false, options: numbers });
          break;
        }
        case "filePicker": {
          const pickers = [];
          for (const option of options) {
            pickers.push({
              label: option.label,
              name: option.name,
              value: option.options?.currentValue ?? "",
              type: option.options?.type ?? "any"
            });
          }
          context.inputs.push({ isFilePicker: true, displayAsRows: config?.displayAsRows ?? false, options: pickers });
          break;
        }
        default:
          log("warn", `Unknown dialog input type: ${type}`);
      }
    }

    switch (this.buttons) {
      case "yesNo":
        context.buttons.push(
          this.makeButton(localize("Yes"), "true"),
          this.makeButton(localize("No"), "false")
        );
        break;
      case "okCancel":
        context.buttons.push(
          this.makeButton(localize("OK", "OK"), "true"),
          this.makeButton(localize("Cancel"), "false")
        );
        break;
      case "ok":
        context.buttons.push(this.makeButton(localize("OK", "OK"), "true"));
        break;
      case "cancel":
        context.buttons.push(this.makeButton(localize("Cancel"), "false"));
        break;
      default:
        break;
    }

    this.context = context;
  }

  async _prepareContext() {
    if (!this.context) this.formatInputs();
    return this.context;
  }

  currentMaxAmounts(input) {
    const context = foundry.utils.deepClone(input);
    const totalMax = context.totalMax;
    let remaining = totalMax;
    if (remaining === undefined) return context;
    for (const option of context.options) remaining -= option.currentAmount * option.weight;
    for (const option of context.options) {
      option.currentMaxAmount = Math.floor((remaining + option.currentAmount * option.weight) / option.weight);
    }
    return context;
  }

  async _onChangeForm(formConfig, event) {
    const target = event.target;
    const context = this.context;
    const match = target.id.match(/i(\d+)j(\d+)/);
    if (!match) return;
    const inputIndex = parseInt(match[1]);
    const optionIndex = parseInt(match[2]);
    let input = context.inputs[inputIndex];
    if (!input) return;

    switch (target.type) {
      case "checkbox": {
        input.options[optionIndex].isChecked = target.checked;
        input.currentNum = input.options.reduce((acc, option) => (option.isChecked ? acc + 1 : acc), 0);
        break;
      }
      case "select-one": {
        if (input.isSelectAmount) {
          input.options[optionIndex].currentAmount = Number(target.value);
          if (input.options[optionIndex]?.weight) {
            input = this.currentMaxAmounts(input);
            context.inputs[inputIndex] = input;
          }
        } else {
          input.options[optionIndex].currentValue = target.value;
        }
        break;
      }
      case "text":
      case "number":
        input.options[optionIndex].value = target.value;
        break;
      case "radio": {
        input.options.forEach(option => (option.isChecked = false));
        input.options[optionIndex].isChecked = target.checked;
        break;
      }
      default:
        if (target.tagName?.toLowerCase() === "multi-select") {
          input.options[optionIndex].value = target.value;
          input.options[optionIndex].options.forEach(option => {
            option.isSelected = target.value.includes(option.value);
          });
        }
    }

    if (target.localName === "file-picker") {
      input.options[optionIndex].value = target.value;
    }

    this.context = context;
    this.render(true);
  }

  _onRender(context) {
    const labels = this.element.querySelectorAll(".label-image");
    for (const label of labels) {
      const parentFor = label.parentElement?.getAttribute("for");
      const match = parentFor?.match(/i(\d+)j(\d+)/);
      if (!match) continue;
      const inputIndex = parseInt(match[1]);
      const optionIndex = parseInt(match[2]);
      const option = context.inputs[inputIndex]?.options?.[optionIndex];
      if (!option) continue;

      label.addEventListener("click", async () => {
        const token = canvas.tokens.get(option.name);
        if (token) await canvas.ping(token.center);
      });
      label.addEventListener("mouseover", () => {
        const token = canvas.tokens.get(option.name);
        if (token) {
          token.hover = true;
          token.refresh();
        }
      });
      label.addEventListener("mouseout", () => {
        const token = canvas.tokens.get(option.name);
        if (token) {
          token.hover = false;
          token.refresh();
        }
      });
    }
  }
}

export { ClasspackDialogApp };
