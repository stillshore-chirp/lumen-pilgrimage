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
  const trigger = button('メニュー');
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
  heading.tabIndex = -1;
  const actions = document.createElement('div');
  actions.className = 'residence-control-actions';
  const back = button('');
  let goBack: (() => void) | undefined;
  back.addEventListener('click', () => goBack?.());
  const close = button('閉じる');
  close.addEventListener('click', () => dialog.close());
  actions.append(back, close);
  header.append(heading, actions);
  const body = document.createElement('div');
  body.className = 'residence-control-body';
  content.append(header, body);
  dialog.append(content);

  const remoteLabel = '住戸の遠隔操作';
  const remote = button(remoteLabel);
  const menu = document.createElement('div');
  menu.className = 'coast-travel-destinations';
  menu.append(remote);
  remote.addEventListener('click', () => showDirectory());

  const directory = document.createElement('div');
  directory.className = 'residence-control-directory';
  const navigation = document.createElement('div');
  navigation.className = 'residence-control-actions';
  navigation.setAttribute('role', 'group');
  navigation.setAttribute('aria-label', '設備の種類');
  const list = document.createElement('section');
  list.id = 'residence-control-list';
  list.className = 'residence-control-lists';
  directory.append(navigation, list);

  const categories = (Object.keys(categoryLabels) as Category[]).flatMap(id => {
    const members = sections.filter(section => section.category === id);
    if (members.length === 0) return [];
    const label = categoryLabels[id];
    const toggle = button(label);
    toggle.setAttribute('aria-controls', list.id);
    toggle.addEventListener('click', () => selectCategory(id));
    navigation.append(toggle);
    const viewport = document.createElement('div');
    viewport.className = 'residence-control-list-viewport';
    const choices = document.createElement('div');
    choices.className = 'coast-travel-destinations';
    for (const section of members) {
      const choice = button(section.title);
      choice.addEventListener('click', () => showDevice(section, choice));
      choices.append(choice);
    }
    viewport.append(choices);
    list.append(viewport);
    return [{ id, label, toggle, viewport }];
  });

  function selectCategory(id: Category): void {
    for (const category of categories) {
      const selected = category.id === id;
      category.toggle.setAttribute('aria-pressed', String(selected));
      category.viewport.inert = !selected;
      if (selected) list.setAttribute('aria-label', category.label);
    }
  }
  if (categories[0]) selectCategory(categories[0].id);

  let activeItems: ReturnType<typeof createControl>[] = [];
  function sync(): void {
    if (dialog.open) {
      for (const item of activeItems) item.sync();
    }
  }

  function showView(title: string, view: HTMLElement, backAction?: { label: string; invoke: () => void }): void {
    heading.textContent = title;
    goBack = backAction?.invoke;
    back.hidden = !backAction;
    back.textContent = backAction?.label ?? '';
    body.replaceChildren(view);
    dialog.scrollTop = 0;
    if (dialog.open) heading.focus();
  }

  function showMenu(): void {
    activeItems = [];
    showView('メニュー', menu);
  }

  function showDirectory(choice?: HTMLButtonElement): void {
    activeItems = [];
    showView(remoteLabel, directory, {
      label: 'メニューへ戻る',
      invoke: () => {
        showMenu();
        remote.focus();
      },
    });
    choice?.focus();
  }

  function showDevice(section: ResidenceControlSection, choice?: HTMLButtonElement): void {
    const items = document.createElement('div');
    items.className = 'residence-control-items';
    items.dataset.residenceSection = section.id;
    activeItems = section.controls.map(control => {
      const item = createControl(control, section.category, sync);
      item.element.dataset.residenceControl = control.id;
      item.sync();
      items.append(item.element);
      return item;
    });
    showView(section.title, items, choice && {
      label: '設備一覧へ戻る',
      invoke: () => showDirectory(choice),
    });
  }

  let lastFocus: HTMLElement | null = null;
  function showModal(returnFocus: HTMLElement): void {
    lastFocus = returnFocus;
    onOpen();
    dialog.showModal();
    trigger.setAttribute('aria-expanded', String(returnFocus === trigger));
    heading.focus();
  }

  function open(sectionId: string, returnFocus: HTMLElement): void {
    const section = sections.find(item => item.id === sectionId);
    if (!section || dialog.open) return;
    showDevice(section);
    showModal(returnFocus);
  }

  trigger.addEventListener('click', () => {
    if (dialog.open) return;
    showMenu();
    showModal(trigger);
  });
  dialog.addEventListener('click', event => {
    if (event.target === dialog) dialog.close();
  });
  dialog.addEventListener('close', () => {
    if (dialog.open) return;
    trigger.setAttribute('aria-expanded', 'false');
    lastFocus?.focus({ preventScroll: true });
    lastFocus = null;
  });
  element.append(trigger, dialog);
  return { element, dialog, open, sync };
}
