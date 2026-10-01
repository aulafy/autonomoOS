import { makeDemoData } from "./fixtures.js";

/** One demo snapshot per page load, shared by all product screens. */
const demoMorning = new Date();
demoMorning.setHours(9, 0, 0, 0);
export const demoData = makeDemoData(demoMorning);
