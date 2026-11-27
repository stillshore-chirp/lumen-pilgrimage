import type { CoastDestination, ExplorationWorldId } from './coastDestinations';
import type { CoastTimeOfDay } from './world/coastAtmosphere';

export interface StartupRoute {
  readonly monitorSender: boolean;
  readonly worldId: ExplorationWorldId;
}

export interface InitialExplorationState {
  readonly placeId: string | null;
  readonly time: CoastTimeOfDay;
}

export type TravelDecision =
  | { readonly kind: 'invalid' }
  | {
    readonly kind: 'navigate';
    readonly url: URL;
    readonly destination: CoastDestination;
  }
  | {
    readonly kind: 'relocate';
    readonly url: URL;
    readonly destination: CoastDestination;
  };

export function parseStartupRoute(search: string): StartupRoute {
  const options = new URLSearchParams(search);
  const requestedWorld = options.get('world');
  const worldId: ExplorationWorldId = requestedWorld === 'overlook' || requestedWorld === 'residence'
    || requestedWorld === 'cinema' || requestedWorld === 'atrium' || requestedWorld === 'lake' ? requestedWorld : 'coast';
  return { monitorSender: options.get('monitor') === 'sender', worldId };
}

export function readInitialExplorationState(worldId: ExplorationWorldId, search: string): InitialExplorationState {
  const options = new URLSearchParams(search);
  return {
    placeId: options.get('place'),
    time: options.get('time') === 'night' || (worldId === 'residence' && !options.has('time')) ? 'night' : 'day',
  };
}

export function decideTravel({ href, currentWorldId, targetWorldId, destination, time }: {
  readonly href: string;
  readonly currentWorldId: ExplorationWorldId;
  readonly targetWorldId: string;
  readonly destination: CoastDestination | undefined;
  readonly time: CoastTimeOfDay;
}): TravelDecision {
  if (!destination) return { kind: 'invalid' };
  const url = new URL(href);
  url.searchParams.set('world', targetWorldId);
  url.searchParams.set('place', destination.id);
  url.searchParams.set('time', time);
  if (targetWorldId === currentWorldId) return { kind: 'relocate', url, destination };
  return { kind: 'navigate', url, destination };
}

export function urlForTime(href: string, time: CoastTimeOfDay): URL {
  const url = new URL(href);
  url.searchParams.set('time', time);
  return url;
}
