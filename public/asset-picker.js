(function () {
  "use strict";

  const instances = new Set();
  let documentListenerBound = false;

  function text(value) {
    return String(value == null ? "" : value).trim();
  }

  function optionEntries(select) {
    return Array.from(select?.options || []).map((option) => ({
      value: option.value,
      label: text(option.textContent) || text(option.value),
      search: `${text(option.value)} ${text(option.textContent)}`.toLowerCase()
    }));
  }

  function datalistEntries(datalist) {
    return Array.from(datalist?.options || []).map((option) => ({
      value: text(option.value),
      label: text(option.label) || text(option.textContent) || text(option.value),
      search: `${text(option.value)} ${text(option.label)} ${text(option.textContent)}`.toLowerCase()
    }));
  }

  function close(instance) {
    instance.list.hidden = true;
    instance.root.classList.remove("is-open");
  }

  function closeAll(except) {
    instances.forEach((instance) => {
      if (instance !== except) close(instance);
    });
  }

  function renderOptions(instance, query) {
    const normalizedQuery = text(query).toLowerCase();
    const options = instance.getOptions().filter((option) => (
      !normalizedQuery || option.search.includes(normalizedQuery)
    ));
    instance.list.textContent = "";

    if (!options.length) {
      const empty = document.createElement("div");
      empty.className = "platform-picker-empty";
      empty.textContent = "No matching options";
      instance.list.append(empty);
      return;
    }

    options.forEach((option) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "platform-picker-option";
      button.dataset.pickerValue = option.value;
      button.setAttribute("role", "option");
      button.textContent = option.label;
      if (option.value === instance.getValue()) {
        button.classList.add("is-selected");
        button.setAttribute("aria-selected", "true");
      }
      instance.list.append(button);
    });
  }

  function open(instance) {
    closeAll(instance);
    instance.root.classList.add("is-open");
    instance.list.hidden = false;
    instance.input.value = "";
    renderOptions(instance, "");
    instance.input.focus();
  }

  function bindCommon(instance) {
    instance.input.addEventListener("focus", () => {
      closeAll(instance);
      instance.root.classList.add("is-open");
      instance.list.hidden = false;
      renderOptions(instance, instance.input.value === instance.selectedLabel ? "" : instance.input.value);
      window.setTimeout(() => instance.input.select(), 0);
    });

    instance.input.addEventListener("input", () => {
      instance.root.classList.add("is-open");
      instance.list.hidden = false;
      renderOptions(instance, instance.input.value);
    });

    instance.input.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        close(instance);
        instance.sync();
        return;
      }
      if (event.key !== "Enter") return;
      const first = instance.list.querySelector("[data-picker-value]");
      if (!first) return;
      event.preventDefault();
      instance.choose(first.dataset.pickerValue);
    });

    instance.toggle.addEventListener("click", () => {
      if (instance.list.hidden) open(instance);
      else close(instance);
    });

    instance.list.addEventListener("mousedown", (event) => {
      if (event.target.closest("[data-picker-value]")) event.preventDefault();
    });

    instance.list.addEventListener("click", (event) => {
      const option = event.target.closest("[data-picker-value]");
      if (option) instance.choose(option.dataset.pickerValue);
    });

    instances.add(instance);
    instance.sync();
  }

  function createSelectPicker(select) {
    if (!select || select.dataset.platformPickerReady === "true") return;
    select.dataset.platformPickerReady = "true";
    select.classList.add("platform-picker-native");

    const root = document.createElement("div");
    root.className = "platform-picker";
    const control = document.createElement("div");
    control.className = "platform-picker-control";
    const input = document.createElement("input");
    input.type = "search";
    input.className = "platform-picker-input";
    input.autocomplete = "off";
    input.setAttribute("aria-label", "Search options");
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "platform-picker-toggle";
    toggle.setAttribute("aria-label", "Open options");
    toggle.textContent = "v";
    const list = document.createElement("div");
    list.className = "platform-picker-list";
    list.hidden = true;
    list.setAttribute("role", "listbox");
    control.append(input, toggle);
    root.append(control, list);
    select.insertAdjacentElement("afterend", root);

    const instance = {
      root,
      input,
      toggle,
      list,
      selectedLabel: "",
      getOptions: () => optionEntries(select),
      getValue: () => select.value,
      choose(value) {
        select.value = value;
        select.dispatchEvent(new Event("change", { bubbles: true }));
        this.sync();
        close(this);
      },
      sync() {
        const selected = this.getOptions().find((option) => option.value === select.value)
          || this.getOptions()[0];
        this.selectedLabel = selected?.label || "";
        this.input.placeholder = select.dataset.platformPickerPlaceholder || "Search or select";
        this.input.value = this.selectedLabel;
        renderOptions(this, "");
      }
    };
    bindCommon(instance);
    instance.observer = new MutationObserver(() => instance.sync());
    instance.observer.observe(select, { childList: true, subtree: true });
  }

  function createInputPicker(input) {
    if (!input || input.dataset.platformPickerReady === "true") return;
    const datalist = document.getElementById(input.dataset.platformPickerList);
    if (!datalist) return;
    input.dataset.platformPickerReady = "true";
    input.removeAttribute("list");
    input.autocomplete = "off";

    const root = document.createElement("div");
    root.className = "platform-picker";
    const control = document.createElement("div");
    control.className = "platform-picker-control";
    const originalInput = input;
    originalInput.classList.add("platform-picker-input");
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "platform-picker-toggle";
    toggle.setAttribute("aria-label", "Open options");
    toggle.textContent = "v";
    const list = document.createElement("div");
    list.className = "platform-picker-list";
    list.hidden = true;
    list.setAttribute("role", "listbox");
    input.parentNode.insertBefore(root, input);
    root.append(control, list);
    control.append(originalInput, toggle);

    const instance = {
      root,
      input: originalInput,
      toggle,
      list,
      selectedLabel: "",
      getOptions: () => datalistEntries(datalist),
      getValue: () => originalInput.value,
      choose(value) {
        originalInput.value = value;
        originalInput.dispatchEvent(new Event("input", { bubbles: true }));
        originalInput.dispatchEvent(new Event("change", { bubbles: true }));
        this.sync();
        close(this);
      },
      sync() {
        const selected = this.getOptions().find((option) => option.value === originalInput.value);
        this.selectedLabel = selected?.label || originalInput.value;
        renderOptions(this, "");
      }
    };
    bindCommon(instance);
    instance.observer = new MutationObserver(() => instance.sync());
    instance.observer.observe(datalist, { childList: true, subtree: true });
  }

  function refreshAll() {
    document.querySelectorAll("select[data-platform-picker]").forEach(createSelectPicker);
    document.querySelectorAll("input[data-platform-picker-list]").forEach(createInputPicker);
    instances.forEach((instance) => instance.sync());
  }

  if (!documentListenerBound) {
    document.addEventListener("click", (event) => {
      if (!event.target.closest(".platform-picker")) closeAll();
    });
    documentListenerBound = true;
  }

  window.PlatformAssetPicker = { refreshAll };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", refreshAll);
  else refreshAll();
}());
