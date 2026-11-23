import './residenceControlPanel.css';

const categoryLabels = {
  lighting: '照明',
  curtains: 'カーテン',
  appliances: '家電・水栓',
};

type Category = keyof typeof categoryLabels;

export type ResidenceControl = { readonly id: string; readonly label: string } & (
  | { readonly kind: 'toggle'; get(): boolean; set(value: boolean): void; disabled?(): boolean }
  | { readonly kind: 'button'; invoke(): void; disabled?(): boolean }
  | {
    readonly kind: 'select';
    readonly options: readonly { readonly value: string; readonly label: string }[];
    get(): string;
    set(value: string): void;
    disabled?(): boolean;
  }
  | { readonly kind: 'color'; get(): string; set(value: string): void }
  | { readonly kind: 'output'; read(): string }
);

export interface ResidenceControlSection {
  readonly id: string;
  readonly title: string;
  readonly category: Category;
  readonly controls: readonly ResidenceControl[];
}

function button(label: string): HTMLButtonElement {
  const element = document.createElement('button');
  element.type = 'button';
  element.textContent = label;
  return element;
}

function createControl(control: ResidenceControl, category: Category, changed: () => void) {
  if (control.kind === 'output') {
    const element = document.createElement('div');
    element.className = 'residence-control-status';
    const label = document.createElement('span');
    label.textContent = control.label;
    const value = document.createElement('span');
    element.append(label, value);
    return { element, sync() {
      const text = control.read();
      if (value.textContent !== text) value.textContent = text;
    } };
  }
  if (control.kind === 'select' || control.kind === 'color') {
    const element = document.createElement('label');
    element.className = 'residence-control-select';
    const label = document.createElement('span');
    label.textContent = control.label;
    let input: HTMLInputElement | HTMLSelectElement;
    if (control.kind === 'color') {
      input = document.createElement('input');
      input.type = 'color';
    } else {
      input = document.createElement('select');
      for (const option of control.options) input.add(new Option(option.label, option.value));
    }
    input.addEventListener(control.kind === 'color' ? 'input' : 'change', () => {
      control.set(input.value);
      changed();
    });
    element.append(label, input);
    return { element, sync() {
      const value = control.get();
      if (input.value !== value) input.value = value;
      if (control.kind === 'select') input.disabled = control.disabled?.() ?? false;
    } };
  }
  const element = button(control.label);
  if (control.kind === 'toggle') {
    const state = document.createElement('span');
    state.className = 'residence-control-value';
    state.setAttribute('aria-hidden', 'true');
    element.append(state);
    element.addEventListener('click', () => { control.set(!control.get()); changed(); });
    return { element, sync() {
      element.disabled = control.disabled?.() ?? false;
      const on = control.get();
      if (element.getAttribute('aria-pressed') === String(on)) return;
      element.setAttribute('aria-pressed', String(on));
      state.textContent = category === 'curtains' ? (on ? '開' : '閉') : (on ? 'ON' : 'OFF');
    } };
  }
  element.addEventListener('click', () => { control.invoke(); changed(); });
  return { element, sync() { element.disabled = control.disabled?.() ?? false; } };
}

export function createResidenceControlPanel(sections: readonly ResidenceControlSection[], onOpen: () => void) {
  const element = document.createElement('div');
  element.className = 'coast-travel-panel';
  const trigger = button('住戸の操作');
  trigger.className = 'coast-residence-toggle';
  trigger.setAttribute('aria-haspopup', 'dialog');
  trigger.setAttribute('aria-controls', 'residence-control-dialog');
  trigger.setAttribute('aria-expanded', 'false');

  const dialog = document.createElement('dialog');
  dialog.id = 'residence-control-dialog';
  dialog.className = 'coast-travel-dialog residence-control-dialog';
  dialog.setAttribute('aria-labelledby', 'residence-control-heading');
  const content = document.createElement('div');
  content.className = 'coast-travel-content';
  const header = document.createElement('header');
  header.className = 'coast-travel-heading';
  const heading = document.createElement('h2');
  heading.id = 'residence-control-heading';
  heading.textContent = trigger.textContent;
  const close = button('閉じる');
  close.autofocus = true;
  close.addEventListener('click', () => dialog.close());
  header.append(heading, close);
  const navigation = document.createElement('div');
  navigation.className = 'residence-control-categories';
  navigation.setAttribute('role', 'group');
  navigation.setAttribute('aria-label', '操作する設備');
  content.append(header, navigation);
  dialog.append(content);

  const groups = sections.map(section => {
    const element = document.createElement('details');
    element.dataset.residenceSection = section.id;
    const title = document.createElement('summary');
    title.textContent = section.title;
    const items = section.controls.map(control => {
      const item = createControl(control, section.category, sync);
      item.element.dataset.residenceControl = control.id;
      item.sync();
      return item;
    });
    const controlList = document.createElement('div');
    controlList.className = 'residence-control-items';
    controlList.append(...items.map(item => item.element));
    element.append(title, controlList);
    element.addEventListener('toggle', sync);
    return { ...section, element, title, items };
  });

  const categories = (Object.keys(categoryLabels) as Category[]).flatMap(id => {
    const members = groups.filter(group => group.category === id);
    if (members.length === 0) return [];
    const toggle = button(categoryLabels[id]);
    const body = document.createElement('section');
    body.className = 'residence-control-group';
    body.id = `residence-controls-${id}`;
    body.setAttribute('aria-label', categoryLabels[id]);
    body.append(...members.map(member => member.element));
    toggle.setAttribute('aria-controls', body.id);
    toggle.addEventListener('click', () => selectCategory(id));
    navigation.append(toggle);
    content.append(body);
    return [{ id, toggle, body }];
  });
  let selected = categories[0]?.id;

  function sync(): void {
    if (!dialog.open) return;
    for (const group of groups) {
      if (group.category === selected && group.element.open) {
        for (const item of group.items) item.sync();
      }
    }
  }

  function selectCategory(id: Category): void {
    selected = id;
    for (const category of categories) {
      category.body.hidden = category.id !== id;
      category.toggle.setAttribute('aria-pressed', String(category.id === id));
    }
    sync();
  }

  let lastFocus: HTMLElement | null = null;
  function open(sectionId?: string): void {
    const group = groups.find(group => group.id === sectionId);
    if (!dialog.open) {
      lastFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      onOpen();
      dialog.showModal();
      trigger.setAttribute('aria-expanded', 'true');
    }
    if (group) {
      selectCategory(group.category);
      group.element.open = true;
      group.title.focus({ preventScroll: true });
      group.element.scrollIntoView({ block: 'nearest' });
    }
    sync();
  }

  trigger.addEventListener('click', () => open());
  dialog.addEventListener('click', event => {
    if (event.target === dialog) dialog.close();
  });
  dialog.addEventListener('close', () => {
    trigger.setAttribute('aria-expanded', 'false');
    if (lastFocus?.isConnected) lastFocus.focus({ preventScroll: true });
  });
  if (selected) selectCategory(selected);
  element.append(trigger, dialog);
  return { element, dialog, open, sync };
}
