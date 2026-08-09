

import type { TechniqueDefinition } from "./types.ts";
import { qualityTechnique } from "./diagnostic/quality.ts";
import { assumptionsTechnique } from "./diagnostic/assumptions.ts";
import { indicatorsTechnique } from "./diagnostic/indicators.ts";
import { achTechnique } from "./diagnostic/ach.ts";
import { devilsAdvocacyTechnique } from "./contrarian/devils_advocacy.ts";
import { teamAbTechnique } from "./contrarian/team_ab.ts";
import { highImpactTechnique } from "./contrarian/high_impact.ts";
import { whatIfTechnique } from "./contrarian/what_if.ts";
import { brainstormingTechnique } from "./imaginative/brainstorming.ts";
import { outsideInTechnique } from "./imaginative/outside_in.ts";
import { redTeamTechnique } from "./imaginative/red_team.ts";
import { altFuturesTechnique } from "./imaginative/alt_futures.ts";

export const ALL_TECHNIQUES: TechniqueDefinition[] = [
	
	qualityTechnique,
	
	assumptionsTechnique,
	indicatorsTechnique,
	
	achTechnique,
	
	devilsAdvocacyTechnique,
	teamAbTechnique,
	highImpactTechnique,
	whatIfTechnique,
	
	brainstormingTechnique,
	outsideInTechnique,
	
	redTeamTechnique,
	altFuturesTechnique,
];


export function buildLayers(techniques: TechniqueDefinition[]): TechniqueDefinition[][] {
	const maxLayer = Math.max(...techniques.map((t) => t.layer));
	const layers: TechniqueDefinition[][] = [];
	for (let i = 0; i <= maxLayer; i++) {
		const layerTechniques = techniques.filter((t) => t.layer === i);
		if (layerTechniques.length > 0) layers.push(layerTechniques);
	}
	return layers;
}


export type { TechniqueDefinition } from "./types.ts";
export type { TechniqueResult } from "./types.ts";
