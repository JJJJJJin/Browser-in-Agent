import { BrowserManager } from './browser/BrowserManager.js';
import { Executor } from './executor/Executor.js';
import { Planner } from './planner/Planner.js';

export const browserManager = new BrowserManager();
export const planner = new Planner();
export const executor = new Executor();

