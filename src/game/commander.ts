import { COMMODITIES } from '../galaxy/galaxy';

// Commander Jameson: everything that persists between sessions. Saved to
// localStorage on every successful docking, classic "save at station" style.

export const MAX_FUEL = 70; // tenths of a light year
export const MAX_MISSILES = 4;

export type LaserType = 'pulse' | 'beam' | 'military';

export interface Equipment {
  largeBay: boolean;
  ecm: boolean;
  laser: LaserType;
  rearLaser: boolean;
  leftLaser: boolean;
  rightLaser: boolean;
  scoops: boolean;
  escapePod: boolean;
  energyUnit: boolean;
  dockingComputer: boolean;
  galacticDrive: boolean;
  energyBomb: boolean;
  miningLaser: boolean;
  combatComputer: boolean;
}

export function defaultEquipment(): Equipment {
  return {
    largeBay: false,
    ecm: false,
    laser: 'pulse',
    rearLaser: false,
    leftLaser: false,
    rightLaser: false,
    scoops: false,
    escapePod: false,
    energyUnit: false,
    dockingComputer: false,
    galacticDrive: false,
    energyBomb: false,
    miningLaser: false,
    combatComputer: false,
  };
}

/** 0 = Clean, 1 = Offender, 2 = Fugitive. */
export const LEGAL_NAMES = ['Clean', 'Offender', 'Fugitive'];

/** Commodity indices the Galactic Government defines as illegal. */
export const ILLEGAL_GOODS = [3, 6, 10]; // slaves, narcotics, firearms

export interface MissionState {
  /** 0 none · 1 constrictor hunt · 2 constrictor done · 3 courier run · 4 all done */
  stage: number;
  targetIndex: number | null;
}

export interface EquipItem {
  id: string;
  name: string;
  price: number; // tenths of a credit
  minTL: number; // displayed tech level required
}

export const EQUIPMENT_CATALOGUE: EquipItem[] = [
  { id: 'missile', name: 'Missile', price: 300, minTL: 1 },
  { id: 'largeBay', name: 'Large Cargo Bay (35t)', price: 4000, minTL: 1 },
  { id: 'ecm', name: 'E.C.M. System', price: 6000, minTL: 2 },
  { id: 'rearLaser', name: 'Rear Pulse Laser', price: 4000, minTL: 3 },
  { id: 'leftLaser', name: 'Left Pulse Laser', price: 4000, minTL: 3 },
  { id: 'rightLaser', name: 'Right Pulse Laser', price: 4000, minTL: 3 },
  { id: 'beam', name: 'Beam Laser', price: 10000, minTL: 4 },
  { id: 'scoops', name: 'Fuel Scoops', price: 5250, minTL: 5 },
  { id: 'escapePod', name: 'Escape Pod', price: 10000, minTL: 6 },
  { id: 'energyBomb', name: 'Energy Bomb', price: 9000, minTL: 7 },
  { id: 'energyUnit', name: 'Extra Energy Unit', price: 15000, minTL: 8 },
  { id: 'dockingComputer', name: 'Docking Computer', price: 15000, minTL: 9 },
  { id: 'miningLaser', name: 'Mining Laser', price: 8000, minTL: 10 },
  { id: 'combatComputer', name: 'Combat Computer', price: 20000, minTL: 9 },
  { id: 'military', name: 'Military Laser', price: 60000, minTL: 10 },
  { id: 'galacticDrive', name: 'Galactic Hyperdrive', price: 50000, minTL: 10 },
];

export function equipmentOwned(id: string, c: CommanderData): boolean {
  const e = c.equipment;
  switch (id) {
    case 'missile': return c.missiles >= MAX_MISSILES;
    case 'largeBay': return e.largeBay;
    case 'ecm': return e.ecm;
    case 'rearLaser': return e.rearLaser;
    case 'leftLaser': return e.leftLaser;
    case 'rightLaser': return e.rightLaser;
    case 'beam': return e.laser !== 'pulse';
    case 'scoops': return e.scoops;
    case 'escapePod': return e.escapePod;
    case 'energyBomb': return e.energyBomb;
    case 'energyUnit': return e.energyUnit;
    case 'dockingComputer': return e.dockingComputer;
    case 'miningLaser': return e.miningLaser;
    case 'combatComputer': return e.combatComputer;
    case 'military': return e.laser === 'military';
    case 'galacticDrive': return e.galacticDrive;
    default: return false;
  }
}

export function cargoCapacity(c: CommanderData): number {
  return c.equipment.largeBay ? 35 : 20;
}

const RATINGS: [number, string][] = [
  [0, 'Harmless'],
  [8, 'Mostly Harmless'],
  [16, 'Poor'],
  [32, 'Below Average'],
  [64, 'Average'],
  [128, 'Above Average'],
  [512, 'Competent'],
  [2560, 'Dangerous'],
  [6400, 'Deadly'],
  [25600, 'E L I T E'],
];

export interface CommanderData {
  name: string;
  galaxy: number;
  systemIndex: number;
  credits: number; // in tenths of a credit, integer
  fuel: number; // tenths of a LY
  missiles: number;
  kills: number;
  cargo: number[]; // quantity per commodity index
  equipment: Equipment;
  legalStatus: number; // 0 clean, 1 offender, 2 fugitive
  mission: MissionState;
}

const SAVE_KEY = 'elite-web-commander';

export function newCommander(): CommanderData {
  return {
    name: 'JAMESON',
    galaxy: 1,
    systemIndex: 7, // Lave
    credits: 1000, // 100.0 Cr
    fuel: MAX_FUEL,
    missiles: 3,
    kills: 0,
    cargo: COMMODITIES.map(() => 0),
    equipment: defaultEquipment(),
    legalStatus: 0,
    mission: { stage: 0, targetIndex: null },
  };
}

export function saveCommander(c: CommanderData): void {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(c));
  } catch {
    // storage unavailable — play on without saves
  }
}

export function loadCommander(): CommanderData {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return newCommander();
    const stored = JSON.parse(raw) as Partial<CommanderData>;
    const parsed = { ...newCommander(), ...stored };
    parsed.equipment = { ...defaultEquipment(), ...(stored.equipment ?? {}) };
    parsed.mission = { stage: 0, targetIndex: null, ...(stored.mission ?? {}) };
    if (!Array.isArray(parsed.cargo) || parsed.cargo.length !== COMMODITIES.length) {
      parsed.cargo = COMMODITIES.map(() => 0);
    }
    return parsed;
  } catch {
    return newCommander();
  }
}

export function rating(kills: number): string {
  let r = RATINGS[0][1];
  for (const [threshold, name] of RATINGS) {
    if (kills >= threshold) r = name;
  }
  return r;
}

/** Tonnes currently used (kg/g commodities don't count against the hold). */
export function cargoTonnes(c: CommanderData): number {
  return c.cargo.reduce((sum, qty, i) => sum + (COMMODITIES[i].unit === 't' ? qty : 0), 0);
}

export function formatCredits(tenths: number): string {
  return `${(tenths / 10).toFixed(1)} Cr`;
}
