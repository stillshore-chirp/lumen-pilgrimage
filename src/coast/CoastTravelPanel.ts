type TimeOfDay = 'day' | 'night';

interface TravelPanelOptions {
  worlds: readonly {
    id: string;
    label: string;
    places: readonly { id: string; label: string }[];
  }[];
  worldId: string;
  time: TimeOfDay;
  onTravel(worldId: string, placeId: string): void;
  onTimeOfDay(time: TimeOfDay): void;
  onOpen?(): void;
}

function button(label: string): HTMLButtonElement {
  const element = document.createElement('button');
  element.type = 'button';
  element.textContent = label;
  return element;
}

export function createCoastTravelPanel(options: TravelPanelOptions) {
  const element = document.createElement('div');
  element.className = 'coast-travel-panel';

  const travel = button('ファストトラベル');
  travel.className = 'coast-travel-toggle';
  travel.setAttribute('aria-haspopup', 'dialog');
  travel.setAttribute('aria-expanded', 'false');
  travel.setAttribute('aria-controls', 'coast-travel-dialog');
  travel.setAttribute('aria-keyshortcuts', 'T');

  const time = document.createElement('div');
  time.className = 'coast-travel-time';
  time.setAttribute('role', 'group');
  time.setAttribute('aria-label', '時間帯');
  const timeButtons = { day: button('昼'), night: button('夜') };
  time.append(timeButtons.day, timeButtons.night);

  const dialog = document.createElement('dialog');
  dialog.id = 'coast-travel-dialog';
  dialog.className = 'coast-travel-dialog';
  dialog.setAttribute('aria-labelledby', 'coast-travel-heading');
  const content = document.createElement('div');
  content.className = 'coast-travel-content';
  const heading = document.createElement('h2');
  heading.id = 'coast-travel-heading';
  heading.textContent = travel.textContent;
  const dismiss = button('閉じる');
  dismiss.autofocus = true;
  const header = document.createElement('div');
  header.className = 'coast-travel-heading';
  header.append(heading, dismiss);
  content.append(header);
  dialog.append(content);

  const worlds = options.worlds.map(world => {
    const group = document.createElement('section');
    group.setAttribute('aria-label', world.label);
    const title = document.createElement('h3');
    title.textContent = world.label;
    const exploring = document.createElement('span');
    exploring.textContent = '探索中';
    title.append(exploring);
    const destinations = document.createElement('div');
    destinations.className = 'coast-travel-destinations';
    const places = world.places.map(place => {
      const destination = button(place.label);
      const recent = document.createElement('span');
      recent.textContent = '直近の移動先';
      destination.append(recent);
      destination.addEventListener('click', () => {
        options.onTravel(world.id, place.id);
        close();
      });
      destinations.append(destination);
      return { id: place.id, destination, recent };
    });
    group.append(title, destinations);
    content.append(group);
    return { id: world.id, exploring, places };
  });

  function open(): void {
    if (dialog.open) return;
    options.onOpen?.();
    dialog.showModal();
    travel.setAttribute('aria-expanded', 'true');
  }

  function close(): void {
    dialog.close();
    travel.setAttribute('aria-expanded', 'false');
  }

  function setTimeOfDay(value: TimeOfDay): void {
    timeButtons.day.setAttribute('aria-pressed', String(value === 'day'));
    timeButtons.night.setAttribute('aria-pressed', String(value === 'night'));
  }

  function setPlace(worldId: string, placeId: string): void {
    for (const world of worlds) {
      world.exploring.hidden = world.id !== worldId;
      for (const place of world.places) {
        const current = world.id === worldId && place.id === placeId;
        place.recent.hidden = !current;
        place.destination.setAttribute('aria-current', String(current));
      }
    }
  }

  travel.addEventListener('click', open);
  dismiss.addEventListener('click', close);
  dialog.addEventListener('close', () => travel.setAttribute('aria-expanded', String(dialog.open)));
  dialog.addEventListener('click', event => {
    if (event.target === dialog) close();
  });
  timeButtons.day.addEventListener('click', () => options.onTimeOfDay('day'));
  timeButtons.night.addEventListener('click', () => options.onTimeOfDay('night'));
  setTimeOfDay(options.time);
  setPlace(options.worldId, '');
  element.append(travel, time, dialog);
  return { element, open, close, setTimeOfDay, setPlace };
}
