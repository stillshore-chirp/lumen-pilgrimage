import { RESIDENCE_ROOMS, RESIDENCE_WALLS, type ResidenceControlLocation, type ResidenceRect } from './world/residence/residencePlan';

const northEdge = Math.max(...RESIDENCE_ROOMS.flatMap(room => room.rectangles.map(rect => rect[3])));
const roomCodes: Readonly<Record<string, string>> = {
  '03': '寝03', '04': '茶04', '05': '書05', LD: 'LD', H1: '廊下', BA: '浴A', BB: '浴B',
  PS: '設備', UT: '洗濯', ST: '収納', WC: 'WC', FO: '玄関', H0: '廊下', K: '台所',
  '02': '寝02', H2: '廊下', MB: '主浴', WI: 'WIC', '01': '寝01', BL: '屋外', C0: '共用', C1: '共用廊下',
};
const svgNS = 'http://www.w3.org/2000/svg';
function svg<K extends keyof SVGElementTagNameMap>(tag: K, attributes: Record<string, string>) {
  const element = document.createElementNS(svgNS, tag);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  return element;
}

/** Same E/N metres as the shell, inverted only for the north-up screen projection. */
export function residencePlanRectPath(rectangles: readonly ResidenceRect[]): string {
  const eastings = [...new Set(rectangles.flatMap(rect => [rect[0], rect[2]]))].sort((a, b) => a - b);
  const northings = [...new Set(rectangles.flatMap(rect => [rect[1], rect[3]]))].sort((a, b) => a - b);
  const occupied = (x: number, y: number) => x >= 0 && y >= 0 && x < eastings.length - 1 && y < northings.length - 1
    && rectangles.some(([west, south, east, north]) => eastings[x] >= west && eastings[x + 1] <= east
      && northings[y] >= south && northings[y + 1] <= north);
  const edges = new Map<string, string>();
  const point = (x: number, y: number) => `${eastings[x]},${northEdge - northings[y]}`;
  const edge = (x: number, y: number, xx: number, yy: number) => edges.set(point(x, y), point(xx, yy));
  // Trace only exposed cell edges: adjacent rectangles belong to one room,
  // so their shared edge must never appear as a wall or selection boundary.
  for (let x = 0; x < eastings.length - 1; x++) for (let y = 0; y < northings.length - 1; y++) {
    if (!occupied(x, y)) continue;
    if (!occupied(x, y - 1)) edge(x, y, x + 1, y);
    if (!occupied(x + 1, y)) edge(x + 1, y, x + 1, y + 1);
    if (!occupied(x, y + 1)) edge(x + 1, y + 1, x, y + 1);
    if (!occupied(x - 1, y)) edge(x, y + 1, x, y);
  }
  let path = '';
  while (edges.size) {
    const start = edges.keys().next().value!;
    let current = start;
    path += `M${start}`;
    do {
      const next = edges.get(current)!;
      edges.delete(current);
      if (next !== start) path += `L${next}`;
      current = next;
    } while (current !== start);
    path += 'Z';
  }
  return path;
}

export function createResidenceControlPlan(roomIds: readonly string[], selectRoom: (id: string) => void) {
  const element = document.createElement('figure');
  element.className = 'residence-control-plan';
  const image = svg('svg', { viewBox: `-.55 -.85 23.9 ${northEdge + 1.5}`, role: 'group',
    'aria-label': '住戸の平面図。北が上。部屋を選ぶと設備を表示', 'data-residence-plan': '' });
  const direction = svg('text', { x: '22.7', y: '-.27', 'text-anchor': 'end', class: 'residence-plan-direction' });
  direction.textContent = '北 ↑';
  image.append(direction);
  const rooms = new Map<string, SVGGElement>();
  for (const room of RESIDENCE_ROOMS) {
    const available = roomIds.includes(room.id);
    const group = svg('g', { 'data-residence-room': room.id, class: `residence-plan-room${available ? ' residence-plan-room-choice' : ''}` });
    if (available) {
      group.setAttribute('role', 'button');
      group.setAttribute('tabindex', '0');
      group.setAttribute('aria-label', `${room.label}の設備を表示`);
      group.addEventListener('click', () => selectRoom(room.id));
      group.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectRoom(room.id); }
      });
    }
    group.append(svg('path', { d: residencePlanRectPath(room.rectangles), class: `residence-plan-floor residence-plan-floor-${room.floor}` }));
    const [west, south, east, north] = room.rectangles[0];
    const label = svg('text', { x: String((west + east) / 2), y: String(northEdge - (south + north) / 2),
      'text-anchor': 'middle', 'dominant-baseline': 'central', 'aria-hidden': 'true' });
    label.textContent = roomCodes[room.id] ?? room.id;
    group.append(label);
    image.append(group);
    rooms.set(room.id, group);
  }
  const walls = svg('g', { 'aria-hidden': 'true', class: 'residence-plan-walls' });
  for (const wall of RESIDENCE_WALLS) {
    const line = (from: number, to: number, className: string) => svg('line', wall.axis === 'e'
      ? { x1: String(from), y1: String(northEdge - wall.fixed), x2: String(to), y2: String(northEdge - wall.fixed), class: className }
      : { x1: String(wall.fixed), y1: String(northEdge - from), x2: String(wall.fixed), y2: String(northEdge - to), class: className });
    let cursor = wall.from;
    for (const opening of [...wall.openings ?? []].sort((a, b) => a.from - b.from)) {
      if (opening.from > cursor) walls.append(line(cursor, opening.from, 'residence-plan-wall'));
      if (opening.kind === 'window') walls.append(line(opening.from, opening.to, 'residence-plan-window'));
      cursor = opening.to;
    }
    if (cursor < wall.to) walls.append(line(cursor, wall.to, 'residence-plan-wall'));
  }
  const markers = svg('g', { class: 'residence-plan-markers', 'aria-hidden': 'true' });
  image.append(walls, markers);
  const caption = document.createElement('figcaption');
  caption.className = 'residence-plan-caption';
  caption.setAttribute('role', 'status');
  caption.setAttribute('aria-live', 'polite');
  caption.setAttribute('aria-atomic', 'true');
  caption.textContent = '部屋を選んで設備を表示';
  element.append(image, caption);
  return {
    element,
    select(location: ResidenceControlLocation | undefined, label?: string) {
      for (const [id, room] of rooms) {
        const selected = id === location?.roomId;
        room.classList.toggle('is-selected', selected);
        if (room.hasAttribute('role')) room.setAttribute('aria-current', selected ? 'true' : 'false');
      }
      markers.replaceChildren();
      for (const [west, south, east, north] of location?.markers ?? []) {
        if (west === east && south === north) {
          markers.append(svg('circle', { cx: String(west), cy: String(northEdge - south), r: '.19',
            'data-plan-east': String(west), 'data-plan-north': String(south) }));
        } else {
          markers.append(svg('line', { x1: String(west), y1: String(northEdge - south),
            x2: String(east), y2: String(northEdge - north), 'data-plan-east': String(west), 'data-plan-north': String(south) }));
        }
      }
      const room = RESIDENCE_ROOMS.find(room => room.id === location?.roomId);
      caption.textContent = room ? `${room.label}${label ? ` ／ ${label}` : ''}` : '部屋を選んで設備を表示';
    },
  };
}
