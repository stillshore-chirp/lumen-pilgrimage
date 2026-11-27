export type ExplorationSound = 'water' | 'birds' | 'insects' | 'wind' | 'traffic' | 'doors'
  | 'appliances' | 'preview' | 'footsteps' | 'crowd';

export interface ExplorationMix {
  readonly master: number;
  readonly environmentOn: boolean;
  readonly footstepsOn: boolean;
  readonly levels: Readonly<Record<ExplorationSound, number>>;
}

export const DEFAULT_EXPLORATION_MIX: ExplorationMix = {
  master: 1,
  environmentOn: true,
  footstepsOn: true,
  levels: {
    water: 1,
    birds: 1,
    insects: 1,
    wind: 1,
    traffic: 1,
    doors: 1,
    appliances: 1,
    preview: 1,
    footsteps: 1,
    crowd: 1,
  },
};

export function explorationSoundGain(mix: ExplorationMix, kind: ExplorationSound): number {
  const on = kind === 'footsteps' ? mix.footstepsOn : mix.environmentOn;
  return on ? mix.levels[kind] : 0;
}

export interface ExplorationSoundSettings {
  readonly master: number;
  readonly environmentOn: boolean | null;
  readonly footstepsOn: boolean | null;
  readonly levels: ExplorationMix['levels'];
}

const SOUND_STORAGE_KEY = 'lumen-pilgrimage:sound';
const INITIAL_SOUND_SETTINGS: ExplorationSoundSettings = {
  ...DEFAULT_EXPLORATION_MIX,
  environmentOn: null,
  footstepsOn: null,
};

function asObject(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

function readGain(value: unknown, max: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max ? value : 1;
}

export function readExplorationSoundSettings(
  fallback: ExplorationSoundSettings = INITIAL_SOUND_SETTINGS,
): ExplorationSoundSettings {
  try {
    const raw = localStorage.getItem(SOUND_STORAGE_KEY);
    if (!raw) return fallback;
    const saved = asObject(JSON.parse(raw));
    const savedLevels = asObject(saved.levels);
    const levels = { ...DEFAULT_EXPLORATION_MIX.levels };
    for (const kind of Object.keys(levels) as ExplorationSound[]) {
      levels[kind] = readGain(savedLevels[kind], 1);
    }
    return {
      master: readGain(saved.master, 3),
      environmentOn: typeof saved.environmentOn === 'boolean' ? saved.environmentOn : null,
      footstepsOn: typeof saved.footstepsOn === 'boolean' ? saved.footstepsOn : null,
      levels,
    };
  } catch {
    return fallback;
  }
}

export function saveExplorationSoundSettings(settings: ExplorationSoundSettings): void {
  try {
    localStorage.setItem(SOUND_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Adjustments remain available for the current page.
  }
}
